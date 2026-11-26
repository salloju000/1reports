using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Administrator-only: which reports each department's collection holds. Assigning a report to a department
/// gives everyone in it access (see <see cref="ReportAccess"/>); it never removes the report from the global
/// library or from any other department. Every call is idempotent, so a repeated drop or a retry is harmless.
/// </summary>
internal static class ReportAssignmentEndpoints
{
    internal static void MapReportAssignments(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin")
            .RequireAuthorization(policy => policy.RequireRole("Administrator").RequireClaim(ClaimTypes.NameIdentifier));
        admin.MapGet("/report-assignments", ListAsync);
        admin.MapPut("/departments/{id:guid}/reports/{reportId}", AssignAsync);
        admin.MapDelete("/departments/{id:guid}/reports/{reportId}", UnassignAsync);
        admin.MapPost("/report-assignments/move", MoveAsync);
    }

    private sealed record MoveRequest(string? ReportId, Guid? From, Guid? To);

    /// <summary>Every report in the library, and every department with the reports in its collection.</summary>
    private static async Task<IResult> ListAsync(ICrystalReportCatalog catalog, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!catalog.Ready) return Unavailable();
        var library = catalog.Entries.Select(entry => entry.Id).ToHashSet(StringComparer.Ordinal);
        var assignments = await db.DepartmentReports.AsNoTracking().ToListAsync(cancellation);
        var people = await db.UserProfiles.Where(row => row.DepartmentId != null)
            .GroupBy(row => row.DepartmentId!.Value).Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.Key, row => row.Count, cancellation);
        var departments = await db.Departments.AsNoTracking().ToListAsync(cancellation);
        return Results.Ok(new
        {
            reports = catalog.Entries.OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .Select(entry => new { entry.Id, entry.Name, entry.Category }),
            departments = departments.OrderBy(row => row.Name, StringComparer.OrdinalIgnoreCase).Select(row => new
            {
                row.Id, row.Name, users = people.GetValueOrDefault(row.Id),
                // Reports no longer published stay assigned (they may return) but are not listed.
                reportIds = assignments.Where(item => item.DepartmentId == row.Id && library.Contains(item.ReportId))
                    .Select(item => item.ReportId).Order(StringComparer.Ordinal).ToArray(),
            }),
        });
    }

    private static async Task<IResult> AssignAsync(Guid id, string reportId, HttpContext context, IAntiforgery antiforgery,
        ICrystalReportCatalog catalog, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (!catalog.Ready) return Unavailable();
        if (await Missing(id, reportId, catalog, db, cancellation) is { } missing) return missing;
        await AddAsync(db, id, reportId, context, cancellation);
        await db.SaveChangesAsync(cancellation);
        return Results.NoContent();
    }

    /// <summary>Takes a report out of one department's collection. The library and other departments are unaffected.</summary>
    private static async Task<IResult> UnassignAsync(Guid id, string reportId, HttpContext context, IAntiforgery antiforgery,
        HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var row = await db.DepartmentReports.FirstOrDefaultAsync(
            item => item.DepartmentId == id && item.ReportId == reportId, cancellation);
        if (row is not null)
        {
            db.DepartmentReports.Remove(row);
            await db.SaveChangesAsync(cancellation);
        }
        return Results.NoContent();
    }

    /// <summary>Moves a report from one department's collection to another's, in one transaction.</summary>
    private static async Task<IResult> MoveAsync(MoveRequest request, HttpContext context, IAntiforgery antiforgery,
        ICrystalReportCatalog catalog, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (string.IsNullOrEmpty(request.ReportId) || request.From is not Guid from || request.To is not Guid to || from == to)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["move"] = ["Choose a report and two different departments."] });
        if (!catalog.Ready) return Unavailable();
        if (await Missing(to, request.ReportId, catalog, db, cancellation) is { } missing) return missing;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellation);
        var source = await db.DepartmentReports.FirstOrDefaultAsync(
            item => item.DepartmentId == from && item.ReportId == request.ReportId, cancellation);
        if (source is not null) db.DepartmentReports.Remove(source);
        await AddAsync(db, to, request.ReportId, context, cancellation);
        await db.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return Results.NoContent();
    }

    private static async Task AddAsync(HubIdentityDb db, Guid department, string reportId, HttpContext context,
        CancellationToken cancellation)
    {
        if (await db.DepartmentReports.AnyAsync(item => item.DepartmentId == department && item.ReportId == reportId, cancellation))
            return;
        db.DepartmentReports.Add(new HubDepartmentReport(department, reportId, DateTimeOffset.UtcNow,
            context.User.FindFirstValue(ClaimTypes.NameIdentifier)!));
    }

    private static async Task<IResult?> Missing(Guid department, string reportId, ICrystalReportCatalog catalog,
        HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await db.Departments.AnyAsync(row => row.Id == department, cancellation))
            return Problem(404, "department-not-found", "That department no longer exists.");
        if (catalog.Entries.All(entry => entry.Id != reportId))
            return Problem(404, "report-not-found", "That report is no longer published.");
        return null;
    }

    private static IResult Unavailable() => Results.Problem("The report catalog is unavailable.", statusCode: 503);

    private static IResult Problem(int status, string code, string detail) =>
        Results.Problem(detail, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });
}
