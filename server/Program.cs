using Microsoft.AspNetCore.DataProtection;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("Hub");
if (string.IsNullOrWhiteSpace(connection) && !builder.Environment.IsDevelopment())
    throw new InvalidOperationException("Configure ConnectionStrings:Hub for the dedicated Hub database.");

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddDataProtection().SetApplicationName("EFIHub")
        .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, "obj", "dev-keys")));
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
        options.ForwardedHeaders = ForwardedHeaders.XForwardedProto);
}
else
{
    // Saved report database passwords are encrypted with these keys, so they must survive restarts
    // and redeployments: they live outside the site folder and are themselves encrypted for this machine.
    var keys = builder.Configuration["DataProtection:KeysPath"] is { Length: > 0 } configured ? configured
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EFIHub", "keys");
    var protection = builder.Services.AddDataProtection().SetApplicationName("EFIHub")
        .PersistKeysToFileSystem(new DirectoryInfo(keys));
    if (OperatingSystem.IsWindows()) protection.ProtectKeysWithDpapi(protectToLocalMachine: true);
}

builder.Services.AddDbContext<HubIdentityDb>(options => options.UseSqlServer(connection));
builder.Services.AddIdentity<IdentityUser, IdentityRole>(options =>
{
    options.SignIn.RequireConfirmedEmail = true;
    options.User.RequireUniqueEmail = true;
    options.Password.RequiredLength = 12;
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
})
.AddEntityFrameworkStores<HubIdentityDb>()
.AddDefaultTokenProviders();
builder.Services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.FromMinutes(1));

builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "__Host-EfiHub";
    options.Cookie.Path = "/";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = false;
    options.Events.OnRedirectToLogin = context =>
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorizationBuilder().SetFallbackPolicy(
    new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "__Host-EfiHub-Csrf";
    options.Cookie.Path = "/";
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("sql-check", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
    options.AddPolicy("sign-in", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
});

builder.Services.AddSingleton<IReportCredentialStore, ReportCredentialStore>();
builder.Services.AddSingleton<CrystalCatalog>();
builder.Services.AddSingleton<ICrystalReportCatalog>(services => services.GetRequiredService<CrystalCatalog>());
builder.Services.AddHostedService(services => services.GetRequiredService<CrystalCatalog>());
var app = builder.Build();
if (Environment.GetEnvironmentVariable("HUB_EMPLOYEE_ACTION") is { Length: > 0 } action)
{
    await EmployeeAdministration.ExecuteAsync(app, action);
    return;
}
if (Environment.GetEnvironmentVariable("HUB_BOOTSTRAP_ADMIN") == "1")
{
    var email = Environment.GetEnvironmentVariable("HUB_ADMIN_EMAIL");
    var password = Environment.GetEnvironmentVariable("HUB_ADMIN_PASSWORD");

    if (string.IsNullOrWhiteSpace(email) ||
        string.IsNullOrWhiteSpace(password))
        throw new InvalidOperationException(
            "Hub administrator credentials are missing.");

    using var scope = app.Services.CreateScope();

    var users = scope.ServiceProvider
        .GetRequiredService<UserManager<IdentityUser>>();

    var roles = scope.ServiceProvider
        .GetRequiredService<RoleManager<IdentityRole>>();
    var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
    await using var transaction = await db.Database.BeginTransactionAsync();

    if (!await roles.RoleExistsAsync("Administrator"))
    {
        var roleResult = await roles.CreateAsync(
            new IdentityRole("Administrator"));

        if (!roleResult.Succeeded)
            throw new Exception("Could not create Administrator role.");
    }

    var user = await users.FindByEmailAsync(email);

    if (user is not null && (!user.EmailConfirmed || !await users.IsInRoleAsync(user, "Administrator")))
        throw new InvalidOperationException("An existing account must already be a confirmed administrator. Use the account administration workflow for changes.");

    if (user == null)
    {
        user = new IdentityUser
        {
            UserName = email,
            Email = email,
            EmailConfirmed = true
        };

        var result = await users.CreateAsync(user, password);

        if (!result.Succeeded)
            throw new Exception(string.Join("; ",
                result.Errors.Select(e => e.Description)));
    }

    if (!await users.IsInRoleAsync(user, "Administrator"))
    {
        var result = await users.AddToRoleAsync(
            user, "Administrator");

        if (!result.Succeeded)
            throw new Exception("Could not assign Administrator role.");
    }

    await transaction.CommitAsync();
    app.Logger.LogInformation(
        "Hub Administrator bootstrap completed.");
    return;
}
if (string.IsNullOrWhiteSpace(connection))
    app.Logger.LogWarning("Hub database is unconfigured. Employee sign-in requires ConnectionStrings:Hub.");
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
else
{
    app.UseForwardedHeaders();
}
app.UseExceptionHandler(error => error.Run(context =>
    Results.Problem(statusCode: StatusCodes.Status500InternalServerError).ExecuteAsync(context)));
app.UseWhen(context => !context.Request.Path.StartsWithSegments("/api"), frontend =>
{
    frontend.UseDefaultFiles();
    frontend.UseStaticFiles();
});
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    await next(context);
});
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapHubAuthentication();
app.MapSqlConnectionCheck();
app.MapCrystalReports();
app.MapReportAdministration();
app.MapWorkspace();
app.MapPeopleAdministration();
app.MapReportAssignments();
app.MapAccount();
app.MapOrganization();
app.Run();

public partial class Program;
