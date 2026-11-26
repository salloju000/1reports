using Microsoft.AspNetCore.Identity;

internal static class EmployeeAdministration
{
    /// <summary>The lockout end that marks an account as deactivated, as opposed to a temporary sign-in lockout.</summary>
    internal static readonly DateTimeOffset DisabledUntil = DateTimeOffset.MaxValue;

    internal static async Task ExecuteAsync(WebApplication app, string action)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var email = Required("HUB_EMPLOYEE_EMAIL").Trim();
        var user = await users.FindByEmailAsync(email);

        if (action == "provision")
        {
            if (user is not null) throw new InvalidOperationException("That account already exists.");
            user = new IdentityUser { UserName = email, Email = email, EmailConfirmed = true, LockoutEnabled = true };
            Ensure(await users.CreateAsync(user, Required("HUB_EMPLOYEE_PASSWORD")));
        }
        else
        {
            if (user is null) throw new InvalidOperationException("The account was not found.");
            switch (action)
            {
                case "grant":
                    var grant = ResolveReportRole(app.Configuration, Required("HUB_EMPLOYEE_ROLE").Trim());
                    var existingRole = await roles.FindByNameAsync(grant);
                    if (existingRole is null) Ensure(await roles.CreateAsync(new IdentityRole(grant)));
                    else if (!string.Equals(existingRole.Name, grant, StringComparison.Ordinal))
                        throw new InvalidOperationException("The stored role name must match the configured report role casing.");
                    if (!await users.IsInRoleAsync(user, grant)) Ensure(await users.AddToRoleAsync(user, grant));
                    break;
                case "revoke":
                    var revoke = Required("HUB_EMPLOYEE_ROLE");
                    if (await users.IsInRoleAsync(user, revoke)) Ensure(await users.RemoveFromRoleAsync(user, revoke));
                    break;
                case "disable":
                    Ensure(await users.SetLockoutEnabledAsync(user, true));
                    Ensure(await users.SetLockoutEndDateAsync(user, DisabledUntil));
                    break;
                case "recover":
                case "reenable":
                    var disabled = await users.GetLockoutEndDateAsync(user) == DisabledUntil;
                    if (disabled != (action == "reenable"))
                        throw new InvalidOperationException(disabled
                            ? "A disabled account requires the explicit reenable operation."
                            : "Use recover for an account that has not been disabled.");
                    var token = await users.GeneratePasswordResetTokenAsync(user);
                    Ensure(await users.ResetPasswordAsync(user, token, Required("HUB_EMPLOYEE_PASSWORD")));
                    Ensure(await users.ResetAccessFailedCountAsync(user));
                    Ensure(await users.SetLockoutEndDateAsync(user, null));
                    break;
                default:
                    throw new InvalidOperationException("Specify provision, grant, revoke, disable, recover, or reenable.");
            }
            Ensure(await users.UpdateSecurityStampAsync(user));
        }
        await transaction.CommitAsync();
        app.Logger.LogInformation("Employee administration completed for action {Action}.", action);
    }

    internal static string ResolveReportRole(IConfiguration configuration, string requested)
    {
        if (string.Equals(requested, "Administrator", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Administrator assignment requires the dedicated administration procedure.");
        var matches = configuration.GetSection("Crystal:Roots").GetChildren()
            .SelectMany(root => root.GetSection("Roles").Get<string[]>() ?? [])
            .Where(role => string.Equals(role, requested, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.Ordinal).ToArray();
        return matches.Length == 1 ? matches[0]
            : throw new InvalidOperationException("Configure one consistent spelling for the approved report role.");
    }

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value && !string.IsNullOrWhiteSpace(value)
            ? value : throw new InvalidOperationException($"Set {name} for this operation.");

    private static void Ensure(IdentityResult result)
    {
        if (!result.Succeeded)
            throw new InvalidOperationException(string.Join(", ", result.Errors.Select(error => error.Code)));
    }
}
