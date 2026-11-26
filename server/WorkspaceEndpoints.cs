using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.EntityFrameworkCore;

internal static class WorkspaceEndpoints
{
    internal static void MapWorkspace(this WebApplication app)
    {
        var workspace = app.MapGroup("/api/workspace")
            .RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireClaim(ClaimTypes.NameIdentifier));
        workspace.MapGet("", ReadAsync);
        workspace.MapPut("/favorites/{id}", SetFavoriteAsync);
    }

    private static async Task<IResult> ReadAsync(
        HttpContext context, ICrystalReportCatalog catalog, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!catalog.Ready) return Results.Problem("The report catalog is unavailable.", statusCode: 503);
        var user = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var reports = await ReportAccess.VisibleAsync(context, catalog, db, cancellation);
        var ids = reports.Select(row => row.Id).ToArray();
        var favorites = await db.Favorites.Where(row => row.UserId == user && ids.Contains(row.ReportId))
            .Select(row => row.ReportId).ToArrayAsync(cancellation);
        var cutoff = DateTimeOffset.UtcNow.AddDays(-90);
        var activity = await db.ReportEvents.Where(row => row.UserId == user && row.At >= cutoff && ids.Contains(row.ReportId))
            .OrderByDescending(row => row.At).ThenBy(row => row.InteractionId).Take(500).ToArrayAsync(cancellation);
        return Results.Ok(new
        {
            reports = reports.Select(row => new { row.Id, row.Name, row.Category, row.UpdatedAt }),
            favorites,
            activity = activity.Select(row => new { row.ReportId, row.Kind, row.At, row.InteractionId }),
        });
    }

    private static async Task<IResult> SetFavoriteAsync(
        string id, FavoriteRequest request, HttpContext context, ICrystalReportCatalog catalog,
        HubIdentityDb db, IAntiforgery antiforgery, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (request.Favorite is not bool favorite)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["favorite"] = ["Specify true or false."] });
        if (!catalog.Ready) return Results.Problem("The report catalog is unavailable.", statusCode: 503);
        if (await ReportAccess.FindAsync(id, context, catalog, db, cancellation) is null) return Results.NotFound();
        var user = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellation);
        int changed;
        if (favorite)
        {
            changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO dbo.Favorites (UserId, ReportId)
                SELECT {user}, {id}
                WHERE NOT EXISTS (SELECT 1 FROM dbo.Favorites WITH (UPDLOCK, HOLDLOCK)
                                  WHERE UserId = {user} AND ReportId = {id})
                """, cancellation);
        }
        else
        {
            changed = await db.Favorites.Where(row => row.UserId == user && row.ReportId == id)
                .ExecuteDeleteAsync(cancellation);
        }
        if (changed > 0)
        {
            db.ReportEvents.Add(new(user, id, Guid.NewGuid(),
                favorite ? "favorite-added" : "favorite-removed", DateTimeOffset.UtcNow));
            await db.SaveChangesAsync(cancellation);
        }
        await transaction.CommitAsync(cancellation);
        return Results.Ok(new { favorite });
    }

    internal static async Task RecordAsync(HubIdentityDb db, HttpContext context, string id, Guid interaction, string kind)
    {
        var user = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO dbo.ReportEvents (UserId, ReportId, InteractionId, Kind, At)
            SELECT {user}, {id}, {interaction}, {kind}, {DateTimeOffset.UtcNow}
            WHERE NOT EXISTS (SELECT 1 FROM dbo.ReportEvents WITH (UPDLOCK, HOLDLOCK)
                              WHERE UserId = {user} AND ReportId = {id} AND InteractionId = {interaction} AND Kind = {kind})
            """, context.RequestAborted);
    }

    private sealed record FavoriteRequest(bool? Favorite);
}
