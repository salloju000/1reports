using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

internal static class AuthEndpoints
{
    internal static void MapHubAuthentication(this WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery) =>
            context.Request.IsHttps
                ? Results.Ok(new { token = antiforgery.GetAndStoreTokens(context).RequestToken })
                : Results.BadRequest())
            .AllowAnonymous();

        auth.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting("sign-in");
        auth.MapPost("/logout", LogoutAsync);
        auth.MapGet("/me", async (HttpContext context, UserManager<IdentityUser> users, HubIdentityDb db) =>
        {
            var user = await users.GetUserAsync(context.User);
            if (user is null) return Results.Unauthorized();
            var profile = await db.UserProfiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == user.Id);
            var department = profile?.DepartmentId is Guid id
                ? await db.Departments.AsNoTracking().Where(row => row.Id == id)
                    .Select(row => new { row.Id, row.Name }).FirstOrDefaultAsync()
                : null;
            return Results.Ok(new
            {
                id = user.Id,
                email = user.Email,
                userName = user.UserName,
                fullName = profile?.FullName ?? "",
                department,
                preferences = AccountEndpoints.Preferences(profile),
                organization = await OrganizationEndpoints.ReadAsync(db, context.RequestAborted),
                roles = await users.GetRolesAsync(user),
            });
        });
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<IdentityUser> users,
        SignInManager<IdentityUser> signIn)
    {
        if (!context.Request.IsHttps || !await antiforgery.IsRequestValidAsync(context))
            return Results.BadRequest();
        if (string.IsNullOrWhiteSpace(request.Email) || request.Email.Length > 254 ||
            string.IsNullOrEmpty(request.Password) || request.Password.Length > 1024)
            return Results.BadRequest();

        // People sign in with their email address or their username.
        var identifier = request.Email.Trim();
        var user = await users.FindByEmailAsync(identifier) ?? await users.FindByNameAsync(identifier);
        if (user is null) return Results.Unauthorized();

        var result = await signIn.PasswordSignInAsync(
            user, request.Password, isPersistent: false, lockoutOnFailure: true);
        return result.Succeeded ? Results.NoContent() : Results.Unauthorized();
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context, IAntiforgery antiforgery, SignInManager<IdentityUser> signIn)
    {
        if (!context.Request.IsHttps || !await antiforgery.IsRequestValidAsync(context))
            return Results.BadRequest();

        await signIn.SignOutAsync();
        return Results.NoContent();
    }

    private sealed record LoginRequest(string? Email, string? Password);
}
