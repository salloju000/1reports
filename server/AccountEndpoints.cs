using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// The signed-in person's own settings: display preferences, saved with their profile so they follow them to
/// any browser, and their password. Everyone may use these for their own account only; nothing here can
/// read or change anyone else's.
/// </summary>
internal static class AccountEndpoints
{
    internal static readonly string[] Views = ["list", "grid"];
    internal static readonly string[] Densities = ["comfortable", "compact"];

    internal static void MapAccount(this WebApplication app)
    {
        var account = app.MapGroup("/api/account")
            .RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireClaim(ClaimTypes.NameIdentifier));
        account.MapPut("/preferences", SavePreferencesAsync);
        account.MapPost("/password", ChangePasswordAsync).RequireRateLimiting("sign-in");
    }

    internal sealed record PreferencesRequest(string? View, string? Density);
    private sealed record PasswordRequest(string? CurrentPassword, string? NewPassword);

    /// <summary>The saved preferences for /api/auth/me, or null when the person has never saved any.</summary>
    internal static object? Preferences(HubUserProfile? profile) =>
        profile?.PreferredView is { } view && profile.Density is { } density ? new { view, density } : null;

    internal static Dictionary<string, string[]> ValidatePreferences(PreferencesRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (!Views.Contains(request.View)) errors["view"] = ["Choose list or grid."];
        if (!Densities.Contains(request.Density)) errors["density"] = ["Choose comfortable or compact."];
        return errors;
    }

    private static async Task<IResult> SavePreferencesAsync(PreferencesRequest request, HttpContext context,
        IAntiforgery antiforgery, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var errors = ValidatePreferences(request);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var user = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var profile = await db.UserProfiles.FindAsync([user], cancellation);
        if (profile is null)
        {
            // Accounts created before the directory (the bootstrap administrator) get a profile on first save.
            if (!await db.Users.AnyAsync(row => row.Id == user, cancellation)) return Results.NotFound();
            profile = new HubUserProfile { UserId = user, FullName = "" };
            db.UserProfiles.Add(profile);
        }
        profile.PreferredView = request.View;
        profile.Density = request.Density;
        await db.SaveChangesAsync(cancellation);
        return Results.NoContent();
    }

    /// <summary>
    /// Changes the person's own password after checking the current one. This session stays signed in;
    /// every other session ends within a minute, when its security stamp is next checked.
    /// </summary>
    private static async Task<IResult> ChangePasswordAsync(PasswordRequest request, HttpContext context,
        IAntiforgery antiforgery, UserManager<IdentityUser> users, SignInManager<IdentityUser> signIn)
    {
        if (!context.Request.IsHttps || !await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrEmpty(request.CurrentPassword) || request.CurrentPassword.Length > 1024)
            errors["currentPassword"] = ["Enter your current password."];
        if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length > 1024)
            errors["newPassword"] = ["Enter a new password."];
        else if (request.NewPassword == request.CurrentPassword)
            errors["newPassword"] = ["Choose a password different from your current one."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var account = await users.GetUserAsync(context.User);
        if (account is null) return Results.Unauthorized();
        var result = await users.ChangePasswordAsync(account, request.CurrentPassword!, request.NewPassword!);
        if (!result.Succeeded)
        {
            return Results.ValidationProblem(result.Errors
                .GroupBy(error => error.Code == "PasswordMismatch" ? "currentPassword" : "newPassword")
                .ToDictionary(group => group.Key, group => group.Key == "currentPassword"
                    ? ["Your current password is incorrect."]
                    : group.Select(error => error.Description).ToArray()));
        }
        await signIn.RefreshSignInAsync(account);
        return Results.NoContent();
    }
}
