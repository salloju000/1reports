using System.Net.Mail;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Administrator-only directory: departments, and the people who sign in to 1Reports.
/// Accounts are Identity users; the full name and department live in <see cref="HubUserProfile"/>.
/// A person gets access either with a password the administrator sets, or with a one-time
/// invitation link they open to choose their own password.
/// </summary>
internal static partial class PeopleEndpoints
{
    internal const string InvitationPurpose = "HubInvitation";

    internal static void MapPeopleAdministration(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin")
            .RequireAuthorization(policy => policy.RequireRole("Administrator").RequireClaim(ClaimTypes.NameIdentifier));
        admin.MapGet("/departments", ListDepartmentsAsync);
        admin.MapPost("/departments", CreateDepartmentAsync);
        admin.MapPut("/departments/{id:guid}", UpdateDepartmentAsync);
        admin.MapDelete("/departments/{id:guid}", DeleteDepartmentAsync);
        admin.MapGet("/users", ListUsersAsync);
        admin.MapPost("/users", CreateUserAsync);
        admin.MapPut("/users/{id}", UpdateUserAsync);
        admin.MapPut("/users/{id}/status", SetStatusAsync);
        admin.MapPost("/users/{id}/invitation", ReissueInvitationAsync);
        app.MapPost("/api/auth/invitation", AcceptInvitationAsync).AllowAnonymous().RequireRateLimiting("sign-in");
    }

    // ── Departments ──────────────────────────────────────────────────────────

    internal sealed record DepartmentRequest(string? Name, string? Description);
    private sealed record DepartmentView(Guid Id, string Name, string? Description, int Users, int Reports = 0);

    private static async Task<IResult> ListDepartmentsAsync(HubIdentityDb db, ICrystalReportCatalog catalog,
        CancellationToken cancellation)
    {
        var counts = await db.UserProfiles.Where(row => row.DepartmentId != null)
            .GroupBy(row => row.DepartmentId!.Value)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.Key, row => row.Count, cancellation);
        // Count only reports that are still published; assignments to retired reports are kept but not shown.
        var published = catalog.Entries.Select(entry => entry.Id).ToHashSet(StringComparer.Ordinal);
        var reports = (await db.DepartmentReports.AsNoTracking().ToListAsync(cancellation))
            .Where(row => published.Contains(row.ReportId))
            .GroupBy(row => row.DepartmentId).ToDictionary(group => group.Key, group => group.Count());
        var departments = await db.Departments.AsNoTracking().ToListAsync(cancellation);
        return Results.Ok(departments.OrderBy(row => row.Name, StringComparer.OrdinalIgnoreCase)
            .Select(row => new DepartmentView(row.Id, row.Name, row.Description, counts.GetValueOrDefault(row.Id),
                reports.GetValueOrDefault(row.Id))));
    }

    private static async Task<IResult> CreateDepartmentAsync(DepartmentRequest request, HttpContext context,
        IAntiforgery antiforgery, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var (name, description, errors) = ValidateDepartment(request);
        if (errors.Count == 0 && await NameTakenAsync(db, name, null, cancellation))
            errors["name"] = ["A department with this name already exists."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var department = new HubDepartment
        {
            Id = Guid.NewGuid(), Name = name, Description = description, CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(department);
        await db.SaveChangesAsync(cancellation);
        return Results.Created($"/api/admin/departments/{department.Id}",
            new DepartmentView(department.Id, department.Name, department.Description, 0));
    }

    private static async Task<IResult> UpdateDepartmentAsync(Guid id, DepartmentRequest request, HttpContext context,
        IAntiforgery antiforgery, HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var department = await db.Departments.FindAsync([id], cancellation);
        if (department is null) return Results.NotFound();
        var (name, description, errors) = ValidateDepartment(request);
        if (errors.Count == 0 && await NameTakenAsync(db, name, id, cancellation))
            errors["name"] = ["A department with this name already exists."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        department.Name = name;
        department.Description = description;
        await db.SaveChangesAsync(cancellation);
        var users = await db.UserProfiles.CountAsync(row => row.DepartmentId == id, cancellation);
        var assigned = await db.DepartmentReports.CountAsync(row => row.DepartmentId == id, cancellation);
        return Results.Ok(new DepartmentView(department.Id, department.Name, department.Description, users, assigned));
    }

    private static async Task<IResult> DeleteDepartmentAsync(Guid id, HttpContext context, IAntiforgery antiforgery,
        HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var department = await db.Departments.FindAsync([id], cancellation);
        if (department is null) return Results.NotFound();
        if (await db.UserProfiles.AnyAsync(row => row.DepartmentId == id, cancellation))
            return Problem(409, "department-in-use", "Move this department's people to another department first.");
        // Its report collection goes with it; the reports stay in the library and in other departments.
        db.Departments.Remove(department);
        await db.SaveChangesAsync(cancellation);
        return Results.NoContent();
    }

    internal static (string Name, string? Description, Dictionary<string, string[]> Errors) ValidateDepartment(
        DepartmentRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        var name = Collapse(request.Name);
        var description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        if (name.Length == 0) errors["name"] = ["Enter a department name."];
        else if (name.Length > HubDepartment.MaxName) errors["name"] = [$"Use at most {HubDepartment.MaxName} characters."];
        if (description?.Length > HubDepartment.MaxDescription)
            errors["description"] = [$"Use at most {HubDepartment.MaxDescription} characters."];
        return (name, description, errors);
    }

    private static Task<bool> NameTakenAsync(HubIdentityDb db, string name, Guid? except, CancellationToken cancellation)
    {
        var upper = name.ToUpperInvariant();
        return db.Departments.AnyAsync(row => row.Name.ToUpper() == upper && row.Id != except, cancellation);
    }

    // ── People ───────────────────────────────────────────────────────────────

    internal sealed record UserRequest(
        string? FullName, string? UserName, string? Email, Guid? DepartmentId,
        string? Access, string? Password, bool? Active, string? Role = null);
    private sealed record UserView(
        string Id, string FullName, string UserName, string Email, Guid? DepartmentId,
        bool Active, bool Administrator, bool InvitationPending);
    private sealed record StatusRequest(bool? Active);
    private sealed record InvitationRequest(string? UserId, string? Token, string? Password);

    private static async Task<IResult> ListUsersAsync(HubIdentityDb db, UserManager<IdentityUser> users,
        CancellationToken cancellation)
    {
        var profiles = await db.UserProfiles.AsNoTracking().ToDictionaryAsync(row => row.UserId, cancellation);
        var administrators = (await users.GetUsersInRoleAsync("Administrator")).Select(row => row.Id).ToHashSet();
        var accounts = await db.Users.AsNoTracking().ToListAsync(cancellation);
        return Results.Ok(accounts
            .Select(account => View(account, profiles.GetValueOrDefault(account.Id), administrators.Contains(account.Id)))
            .OrderBy(view => string.IsNullOrEmpty(view.FullName) ? view.Email : view.FullName, StringComparer.OrdinalIgnoreCase));
    }

    private static async Task<IResult> CreateUserAsync(UserRequest request, HttpContext context, IAntiforgery antiforgery,
        HubIdentityDb db, UserManager<IdentityUser> users, RoleManager<IdentityRole> roles, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var input = ValidateUser(request, creating: true);
        var errors = input.Errors;
        if (errors.Count == 0) await CheckDirectoryAsync(input, null, db, users, errors, cancellation);
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var invite = input.Access == "invite";
        await using var transaction = await db.Database.BeginTransactionAsync(cancellation);
        var account = new IdentityUser
        {
            UserName = input.UserName, Email = input.Email, LockoutEnabled = true,
            // An administrator who sets the password vouches for the address; an invited person
            // confirms it by opening the link sent to them.
            EmailConfirmed = !invite,
        };
        var created = invite ? await users.CreateAsync(account) : await users.CreateAsync(account, input.Password!);
        if (!created.Succeeded) return Results.ValidationProblem(IdentityErrors(created));
        if (request.Active == false) await users.SetLockoutEndDateAsync(account, EmployeeAdministration.DisabledUntil);
        var administrator = input.Role == "administrator";
        if (administrator) await GrantAdministratorAsync(account, users, roles);
        db.UserProfiles.Add(new HubUserProfile
        {
            UserId = account.Id, FullName = input.FullName, DepartmentId = input.DepartmentId,
        });
        await db.SaveChangesAsync(cancellation);
        var token = invite ? await users.GenerateUserTokenAsync(account, TokenOptions.DefaultProvider, InvitationPurpose) : null;
        await transaction.CommitAsync(cancellation);

        var profile = await db.UserProfiles.AsNoTracking().FirstAsync(row => row.UserId == account.Id, cancellation);
        return Results.Created($"/api/admin/users/{account.Id}", new
        {
            user = View(account, profile, administrator),
            invitation = token is null ? null : new { userId = account.Id, token },
        });
    }

    private static async Task<IResult> UpdateUserAsync(string id, UserRequest request, HttpContext context,
        IAntiforgery antiforgery, HubIdentityDb db, UserManager<IdentityUser> users, RoleManager<IdentityRole> roles,
        CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var account = await users.FindByIdAsync(id);
        if (account is null) return Results.NotFound();
        var input = ValidateUser(request, creating: false);
        var errors = input.Errors;
        if (errors.Count == 0) await CheckDirectoryAsync(input, account.Id, db, users, errors, cancellation);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var wasAdministrator = await users.IsInRoleAsync(account, ReportAccess.AdministratorRole);
        // Role is optional on update: leaving it out keeps the current one.
        var makeAdministrator = input.Role is null ? wasAdministrator : input.Role == "administrator";
        if (wasAdministrator && !makeAdministrator)
        {
            if (account.Id == context.User.FindFirstValue(ClaimTypes.NameIdentifier))
                return Problem(409, "self-demotion", "You can't remove your own administrator role.");
            if (!await AnotherActiveAdministratorAsync(account, users))
                return Problem(409, "last-administrator", "Keep at least one active administrator.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellation);
        var identityChanged = !string.Equals(account.UserName, input.UserName, StringComparison.Ordinal)
            || !string.Equals(account.Email, input.Email, StringComparison.Ordinal);
        account.UserName = input.UserName;
        account.Email = input.Email;
        var updated = await users.UpdateAsync(account);
        if (!updated.Succeeded) return Results.ValidationProblem(IdentityErrors(updated));
        // A new sign-in name or address ends the person's existing sessions.
        if (identityChanged) await users.UpdateSecurityStampAsync(account);

        var profile = await db.UserProfiles.FindAsync([account.Id], cancellation);
        if (profile is null)
        {
            profile = new HubUserProfile { UserId = account.Id, FullName = input.FullName };
            db.UserProfiles.Add(profile);
        }
        profile.FullName = input.FullName;
        profile.DepartmentId = input.DepartmentId;
        await db.SaveChangesAsync(cancellation);
        if (makeAdministrator != wasAdministrator)
        {
            if (makeAdministrator) await GrantAdministratorAsync(account, users, roles);
            else Ensure(await users.RemoveFromRoleAsync(account, ReportAccess.AdministratorRole));
            // A role change takes effect in the person's open sessions within a minute.
            Ensure(await users.UpdateSecurityStampAsync(account));
        }
        await transaction.CommitAsync(cancellation);
        return Results.Ok(View(account, profile, makeAdministrator));
    }

    private static async Task<IResult> SetStatusAsync(string id, StatusRequest request, HttpContext context,
        IAntiforgery antiforgery, HubIdentityDb db, UserManager<IdentityUser> users, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (request.Active is not bool active)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["active"] = ["Specify true or false."] });
        var account = await users.FindByIdAsync(id);
        if (account is null) return Results.NotFound();
        if (!active)
        {
            if (account.Id == context.User.FindFirstValue(ClaimTypes.NameIdentifier))
                return Problem(409, "self-deactivation", "You can't deactivate your own account.");
            if (await users.IsInRoleAsync(account, ReportAccess.AdministratorRole)
                && !await AnotherActiveAdministratorAsync(account, users))
                return Problem(409, "last-administrator", "Keep at least one active administrator.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellation);
        Ensure(await users.SetLockoutEnabledAsync(account, true));
        Ensure(await users.SetLockoutEndDateAsync(account, active ? null : EmployeeAdministration.DisabledUntil));
        if (active) Ensure(await users.ResetAccessFailedCountAsync(account));
        // Deactivation signs the person out everywhere within a minute (the security stamp check interval).
        else Ensure(await users.UpdateSecurityStampAsync(account));
        await transaction.CommitAsync(cancellation);
        var profile = await db.UserProfiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == account.Id, cancellation);
        return Results.Ok(View(account, profile, await users.IsInRoleAsync(account, "Administrator")));
    }

    /// <summary>Issues a fresh invitation link for someone who has not yet chosen a password. Earlier links stop working.</summary>
    private static async Task<IResult> ReissueInvitationAsync(string id, HttpContext context, IAntiforgery antiforgery,
        UserManager<IdentityUser> users)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var account = await users.FindByIdAsync(id);
        if (account is null) return Results.NotFound();
        if (await users.HasPasswordAsync(account))
            return Problem(409, "invitation-accepted", "This person has already set a password.");
        Ensure(await users.UpdateSecurityStampAsync(account));
        var token = await users.GenerateUserTokenAsync(account, TokenOptions.DefaultProvider, InvitationPurpose);
        return Results.Ok(new { userId = account.Id, token });
    }

    /// <summary>The invited person chooses a password. The link works once, and only until a password exists.</summary>
    private static async Task<IResult> AcceptInvitationAsync(InvitationRequest request, HttpContext context,
        IAntiforgery antiforgery, UserManager<IdentityUser> users)
    {
        if (!context.Request.IsHttps || !await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var invalid = Problem(400, "invitation-invalid",
            "This invitation link is invalid or has expired. Ask your administrator for a new one.");
        if (string.IsNullOrEmpty(request.UserId) || string.IsNullOrEmpty(request.Token) || request.Token.Length > 2048
            || string.IsNullOrEmpty(request.Password) || request.Password.Length > 1024) return invalid;
        var account = await users.FindByIdAsync(request.UserId);
        if (account is null || await users.HasPasswordAsync(account) || account.LockoutEnd == EmployeeAdministration.DisabledUntil
            || !await users.VerifyUserTokenAsync(account, TokenOptions.DefaultProvider, InvitationPurpose, request.Token))
            return invalid;
        var added = await users.AddPasswordAsync(account, request.Password);
        if (!added.Succeeded) return Results.ValidationProblem(IdentityErrors(added));
        account.EmailConfirmed = true;
        Ensure(await users.UpdateAsync(account));
        Ensure(await users.UpdateSecurityStampAsync(account));
        return Results.NoContent();
    }

    // ── Rules ────────────────────────────────────────────────────────────────

    internal sealed record ValidUser(
        string FullName, string UserName, string Email, Guid? DepartmentId, string Access, string? Password,
        Dictionary<string, string[]> Errors, string? Role = null);

    private static async Task<bool> AnotherActiveAdministratorAsync(IdentityUser account, UserManager<IdentityUser> users) =>
        (await users.GetUsersInRoleAsync(ReportAccess.AdministratorRole))
            .Any(row => row.Id != account.Id && row.LockoutEnd != EmployeeAdministration.DisabledUntil);

    private static async Task GrantAdministratorAsync(IdentityUser account, UserManager<IdentityUser> users,
        RoleManager<IdentityRole> roles)
    {
        if (!await roles.RoleExistsAsync(ReportAccess.AdministratorRole))
            Ensure(await roles.CreateAsync(new IdentityRole(ReportAccess.AdministratorRole)));
        if (!await users.IsInRoleAsync(account, ReportAccess.AdministratorRole))
            Ensure(await users.AddToRoleAsync(account, ReportAccess.AdministratorRole));
    }

    /// <summary>Shape checks that need no database. Uniqueness and the department's existence are checked after.</summary>
    internal static ValidUser ValidateUser(UserRequest request, bool creating)
    {
        var errors = new Dictionary<string, string[]>();
        var fullName = Collapse(request.FullName);
        var userName = request.UserName?.Trim() ?? "";
        var email = request.Email?.Trim() ?? "";
        var access = request.Access?.Trim().ToLowerInvariant() ?? "";
        var role = request.Role?.Trim().ToLowerInvariant();
        if (role is not (null or "user" or "administrator")) errors["role"] = ["Choose User or Administrator."];

        if (fullName.Length == 0) errors["fullName"] = ["Enter the person's full name."];
        else if (fullName.Length > HubUserProfile.MaxFullName) errors["fullName"] = [$"Use at most {HubUserProfile.MaxFullName} characters."];

        if (userName.Length < 3) errors["userName"] = ["Use at least 3 characters."];
        else if (userName.Length > 256) errors["userName"] = ["Use at most 256 characters."];
        else if (!UserNamePattern().IsMatch(userName))
            errors["userName"] = ["Use letters, numbers and . _ - only, or the email address."];
        // A username that looks like an address must be the person's own address, so signing in
        // with "name or email" can never match two different people.
        else if (userName.Contains('@') && !string.Equals(userName, email, StringComparison.OrdinalIgnoreCase))
            errors["userName"] = ["A username containing @ must be the person's email address."];

        if (email.Length == 0) errors["email"] = ["Enter an email address."];
        else if (email.Length > 254 || !IsEmail(email)) errors["email"] = ["Enter a valid email address."];

        if (request.DepartmentId is null || request.DepartmentId == Guid.Empty) errors["departmentId"] = ["Choose a department."];

        if (creating)
        {
            if (access is not ("invite" or "password")) errors["access"] = ["Choose an invitation link or a password."];
            else if (access == "password" && string.IsNullOrEmpty(request.Password)) errors["password"] = ["Enter a password."];
            else if (request.Password?.Length > 1024) errors["password"] = ["Use at most 1024 characters."];
        }
        return new(fullName, userName, email, request.DepartmentId, access, request.Password, errors, role);
    }

    private static async Task CheckDirectoryAsync(ValidUser input, string? self, HubIdentityDb db,
        UserManager<IdentityUser> users, Dictionary<string, string[]> errors, CancellationToken cancellation)
    {
        if (await users.FindByNameAsync(input.UserName) is { } byName && byName.Id != self)
            errors["userName"] = ["This username is already in use."];
        // Sign-in accepts an email or a username, so neither may collide with the other kind either.
        else if (await users.FindByEmailAsync(input.UserName) is { } byNameAsEmail && byNameAsEmail.Id != self)
            errors["userName"] = ["This username is already someone's email address."];
        if (await users.FindByEmailAsync(input.Email) is { } byEmail && byEmail.Id != self)
            errors["email"] = ["This email address is already in use."];
        if (!await db.Departments.AnyAsync(row => row.Id == input.DepartmentId, cancellation))
            errors["departmentId"] = ["Choose a department."];
    }

    private static UserView View(IdentityUser account, HubUserProfile? profile, bool administrator) => new(
        account.Id, profile?.FullName ?? "", account.UserName ?? "", account.Email ?? "", profile?.DepartmentId,
        account.LockoutEnd != EmployeeAdministration.DisabledUntil, administrator,
        InvitationPending: account.PasswordHash is null);

    /// <summary>Maps Identity's errors (password policy, duplicates) onto the form fields they belong to.</summary>
    internal static Dictionary<string, string[]> IdentityErrors(IdentityResult result) => result.Errors
        .GroupBy(error => error.Code.StartsWith("Password", StringComparison.Ordinal) ? "password"
            : error.Code.Contains("UserName", StringComparison.Ordinal) ? "userName"
            : error.Code.Contains("Email", StringComparison.Ordinal) ? "email" : "form")
        .ToDictionary(group => group.Key, group => group.Select(error => error.Description).ToArray());

    private static string Collapse(string? value) => WhitespacePattern().Replace(value?.Trim() ?? "", " ");

    private static bool IsEmail(string value) =>
        MailAddress.TryCreate(value, out var address) && address.Address == value && address.Host.Contains('.', StringComparison.Ordinal);

    private static IResult Problem(int status, string code, string detail) =>
        Results.Problem(detail, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });

    private static void Ensure(IdentityResult result)
    {
        if (!result.Succeeded) throw new InvalidOperationException(string.Join(", ", result.Errors.Select(error => error.Code)));
    }

    [GeneratedRegex(@"^[A-Za-z0-9._@+-]+$")]
    private static partial Regex UserNamePattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespacePattern();
}
