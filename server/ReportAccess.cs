using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Who may open a report. Two roles:
/// <list type="bullet">
/// <item>Administrators may open every published report (they manage them).</item>
/// <item>Everyone else may open only the reports in their department's collection, assigned on the
/// Report access page. Someone without a department, or in a department with no reports, sees none.</item>
/// </list>
/// Every report endpoint (list, workspace, detail, view, render, favorites) asks here, so a report that is
/// not assigned cannot be reached by a direct URL or API call either: it answers 404, as if it did not exist.
/// </summary>
internal static class ReportAccess
{
    internal const string AdministratorRole = "Administrator";

    internal static bool IsAdministrator(HttpContext context) => context.User.IsInRole(AdministratorRole);

    internal static async Task<CrystalEntry[]> VisibleAsync(HttpContext context, ICrystalReportCatalog catalog,
        HubIdentityDb db, CancellationToken cancellation)
    {
        if (IsAdministrator(context)) return catalog.Entries;
        var assigned = await AssignedAsync(context, db, cancellation);
        return assigned.Count == 0 ? [] : catalog.Entries.Where(entry => assigned.Contains(entry.Id)).ToArray();
    }

    internal static async Task<CrystalEntry?> FindAsync(string id, HttpContext context, ICrystalReportCatalog catalog,
        HubIdentityDb db, CancellationToken cancellation)
    {
        var entry = catalog.Entries.FirstOrDefault(row => row.Id == id);
        if (entry is null || IsAdministrator(context)) return entry;
        return (await AssignedAsync(context, db, cancellation)).Contains(entry.Id) ? entry : null;
    }

    /// <summary>The report ids in the signed-in person's department collection.</summary>
    private static async Task<HashSet<string>> AssignedAsync(HttpContext context, HubIdentityDb db,
        CancellationToken cancellation)
    {
        var user = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (user is null) return [];
        var ids = await (
            from profile in db.UserProfiles
            where profile.UserId == user && profile.DepartmentId != null
            join assignment in db.DepartmentReports on profile.DepartmentId equals assignment.DepartmentId
            select assignment.ReportId).ToListAsync(cancellation);
        return ids.ToHashSet(StringComparer.Ordinal);
    }
}
