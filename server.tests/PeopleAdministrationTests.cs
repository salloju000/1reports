using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

public sealed class PeopleAdministrationTests
{
    private const string StrongPassword = "Corrugated-Roll-2026!";
    private static readonly Guid Printing = new("d3a1e0f0-0000-4000-8000-000000000006");
    private static readonly Guid Quality = new("d3a1e0f0-0000-4000-8000-000000000010");

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData("Employee", HttpStatusCode.Forbidden)]
    [InlineData("InventoryReader", HttpStatusCode.Forbidden)]
    public async Task OnlyAdministratorsReachPeopleAdministration(string? role, HttpStatusCode expected)
    {
        await using var factory = CreateFactory();
        using var client = Client(factory, role);
        foreach (var route in new[] { "/api/admin/users", "/api/admin/departments" })
        {
            using var response = await client.GetAsync(route);
            Assert.Equal(expected, response.StatusCode);
        }
    }

    [Fact]
    public async Task AdministratorsManagePeopleDepartmentWise()
    {
        await using var factory = CreateFactory();
        await SeedAdministratorAsync(factory);
        using var client = await AdminClientAsync(factory);

        using var departments = await client.GetFromJsonAsync<JsonDocument>("/api/admin/departments");
        Assert.Equal(18, departments!.RootElement.GetArrayLength());

        using var created = await client.PostAsJsonAsync("/api/admin/users", new
        {
            fullName = "  Asha   Patil ", userName = "asha.patil", email = "asha@plant.example",
            departmentId = Printing, access = "password", password = StrongPassword,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var body = await created.Content.ReadFromJsonAsync<JsonDocument>();
        var user = body!.RootElement.GetProperty("user");
        var id = user.GetProperty("id").GetString()!;
        Assert.Equal("Asha Patil", user.GetProperty("fullName").GetString());
        Assert.True(user.GetProperty("active").GetBoolean());
        Assert.False(user.GetProperty("invitationPending").GetBoolean());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("invitation").ValueKind);

        // The same username, or an address already in use, is refused field by field.
        using var duplicate = await client.PostAsJsonAsync("/api/admin/users", new
        {
            fullName = "Another", userName = "ASHA.PATIL", email = "asha@plant.example",
            departmentId = Printing, access = "invite",
        });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        var errors = await Errors(duplicate);
        Assert.True(errors.TryGetProperty("userName", out _));
        Assert.True(errors.TryGetProperty("email", out _));

        // Move to Quality Assurance; department counts follow.
        using var moved = await client.PutAsJsonAsync($"/api/admin/users/{id}", new
        {
            fullName = "Asha Patil", userName = "asha.patil", email = "asha@plant.example", departmentId = Quality,
        });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        using var counted = await client.GetFromJsonAsync<JsonDocument>("/api/admin/departments");
        Assert.Equal(1, Department(counted!, Quality).GetProperty("users").GetInt32());
        Assert.Equal(0, Department(counted!, Printing).GetProperty("users").GetInt32());

        // A department with people cannot be removed.
        using var inUse = await client.DeleteAsync($"/api/admin/departments/{Quality}");
        Assert.Equal(HttpStatusCode.Conflict, inUse.StatusCode);

        // Deactivate, then reactivate.
        using var off = await client.PutAsJsonAsync($"/api/admin/users/{id}/status", new { active = false });
        Assert.False((await off.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement.GetProperty("active").GetBoolean());
        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
            Assert.True(await users.IsLockedOutAsync((await users.FindByIdAsync(id))!));
        }
        using var on = await client.PutAsJsonAsync($"/api/admin/users/{id}/status", new { active = true });
        Assert.True((await on.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement.GetProperty("active").GetBoolean());

        using var listed = await client.GetFromJsonAsync<JsonDocument>("/api/admin/users");
        var asha = listed!.RootElement.EnumerateArray().Single(row => row.GetProperty("id").GetString() == id);
        Assert.Equal(Quality, asha.GetProperty("departmentId").GetGuid());
    }

    [Fact]
    public async Task AdministratorsCannotDeactivateThemselvesAndDepartmentsStayUnique()
    {
        await using var factory = CreateFactory();
        await SeedAdministratorAsync(factory);
        using var client = await AdminClientAsync(factory);

        using var self = await client.PutAsJsonAsync("/api/admin/users/test-user/status", new { active = false });
        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);

        using var duplicate = await client.PostAsJsonAsync("/api/admin/departments", new { name = "printing" });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        using var created = await client.PostAsJsonAsync("/api/admin/departments", new { name = "Ink Kitchen" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement.GetProperty("id").GetGuid();
        using var renamed = await client.PutAsJsonAsync($"/api/admin/departments/{id}", new { name = "Ink & Coating Kitchen" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        using var removed = await client.DeleteAsync($"/api/admin/departments/{id}");
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
    }

    [Fact]
    public async Task AdministratorsGrantAndRemoveTheAdministratorRoleWithinSafeLimits()
    {
        await using var factory = CreateFactory();
        await SeedAdministratorAsync(factory);
        using var client = await AdminClientAsync(factory);
        using var created = await client.PostAsJsonAsync("/api/admin/users", new
        {
            fullName = "Second Admin", userName = "second.admin", email = "second@plant.example",
            departmentId = Quality, access = "password", password = StrongPassword, role = "administrator",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement
            .GetProperty("user").GetProperty("id").GetString()!;
        Assert.Contains(await RolesAsync(factory, id), role => role == "Administrator");

        // Nobody removes their own administrator role.
        using var self = await client.PutAsJsonAsync("/api/admin/users/test-user", new
        {
            fullName = "Admin", userName = "admin@plant.example", email = "admin@plant.example",
            departmentId = Quality, role = "user",
        });
        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);

        // Another administrator can be made a user; leaving role out keeps it unchanged.
        using var kept = await client.PutAsJsonAsync($"/api/admin/users/{id}", new
        {
            fullName = "Second Admin", userName = "second.admin", email = "second@plant.example", departmentId = Quality,
        });
        Assert.True((await kept.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement.GetProperty("administrator").GetBoolean());
        using var demoted = await client.PutAsJsonAsync($"/api/admin/users/{id}", new
        {
            fullName = "Second Admin", userName = "second.admin", email = "second@plant.example",
            departmentId = Quality, role = "user",
        });
        Assert.Equal(HttpStatusCode.OK, demoted.StatusCode);
        Assert.DoesNotContain(await RolesAsync(factory, id), role => role == "Administrator");

        using var invalid = await client.PutAsJsonAsync($"/api/admin/users/{id}", new
        {
            fullName = "Second Admin", userName = "second.admin", email = "second@plant.example",
            departmentId = Quality, role = "owner",
        });
        Assert.True((await Errors(invalid)).TryGetProperty("role", out _));
    }

    private static async Task<IList<string>> RolesAsync(WebApplicationFactory<Program> factory, string id)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        return await users.GetRolesAsync((await users.FindByIdAsync(id))!);
    }

    [Fact]
    public async Task InvitedPeopleChooseTheirOwnPasswordOnceAndSignInWithTheirUsername()
    {
        await using var factory = CreateFactory();
        await SeedAdministratorAsync(factory);
        using var admin = await AdminClientAsync(factory);
        using var created = await admin.PostAsJsonAsync("/api/admin/users", new
        {
            fullName = "Ravi Kumar", userName = "ravi.k", email = "ravi@plant.example",
            departmentId = Printing, access = "invite",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var body = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.True(body!.RootElement.GetProperty("user").GetProperty("invitationPending").GetBoolean());
        var invitation = body.RootElement.GetProperty("invitation");
        var userId = invitation.GetProperty("userId").GetString();
        var token = invitation.GetProperty("token").GetString();

        using var guest = await AnonymousClientAsync(factory);
        using var weak = await guest.PostAsJsonAsync("/api/auth/invitation", new { userId, token, password = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.True((await Errors(weak)).TryGetProperty("password", out _));

        using var forged = await guest.PostAsJsonAsync("/api/auth/invitation", new { userId, token = "forged", password = StrongPassword });
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);

        using var accepted = await guest.PostAsJsonAsync("/api/auth/invitation", new { userId, token, password = StrongPassword });
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
        using var reused = await guest.PostAsJsonAsync("/api/auth/invitation", new { userId, token, password = StrongPassword });
        Assert.Equal(HttpStatusCode.BadRequest, reused.StatusCode);

        using var reissue = await admin.PostAsync($"/api/admin/users/{userId}/invitation", null);
        Assert.Equal(HttpStatusCode.Conflict, reissue.StatusCode);

        using var signIn = await guest.PostAsJsonAsync("/api/auth/login", new { email = "ravi.k", password = StrongPassword });
        Assert.Equal(HttpStatusCode.NoContent, signIn.StatusCode);
    }

    [Theory]
    [InlineData("", "ok.name", "ok@plant.example", "fullName")]
    [InlineData("Name", "x", "ok@plant.example", "userName")]
    [InlineData("Name", "has space", "ok@plant.example", "userName")]
    [InlineData("Name", "other@plant.example", "ok@plant.example", "userName")]
    [InlineData("Name", "ok.name", "not-an-address", "email")]
    [InlineData("Name", "ok.name", "ok@localhost", "email")]
    public void UserDetailsAreValidatedBeforeTouchingTheDirectory(string fullName, string userName, string email, string field)
    {
        var result = PeopleEndpoints.ValidateUser(
            new(fullName, userName, email, Printing, "invite", null, null), creating: true);
        Assert.True(result.Errors.ContainsKey(field));
    }

    [Fact]
    public void AnEmailCanBeItsOwnUsernameAndDepartmentAndAccessAreRequired()
    {
        var own = PeopleEndpoints.ValidateUser(
            new("Name", "Ok@Plant.example", "ok@plant.example", Printing, "invite", null, null), creating: true);
        Assert.Empty(own.Errors);
        var missing = PeopleEndpoints.ValidateUser(
            new("Name", "ok.name", "ok@plant.example", null, "password", null, null), creating: true);
        Assert.True(missing.Errors.ContainsKey("departmentId"));
        Assert.True(missing.Errors.ContainsKey("password"));
    }

    // ── Harness ──────────────────────────────────────────────────────────────

    private static WebApplicationFactory<Program> CreateFactory()
    {
        var database = Guid.NewGuid().ToString();
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseContentRoot(Path.GetFullPath("../../../../server", AppContext.BaseDirectory));
            builder.UseEnvironment("Development");
            builder.ConfigureTestServices(services =>
            {
                services.UseInMemoryHub(database);
                services.AddAuthentication(options => options.DefaultAuthenticateScheme = "Test")
                    .AddScheme<AuthenticationSchemeOptions, TestAuthentication>("Test", _ => { });
            });
        });
    }

    /// <summary>The signed-in test administrator has the id the test authentication handler claims.</summary>
    private static async Task SeedAdministratorAsync(WebApplicationFactory<Program> factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        await db.Database.EnsureCreatedAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        await roles.CreateAsync(new IdentityRole("Administrator"));
        var admin = new IdentityUser { Id = "test-user", UserName = "admin@plant.example", Email = "admin@plant.example", EmailConfirmed = true };
        Assert.True((await users.CreateAsync(admin, StrongPassword)).Succeeded);
        await users.AddToRoleAsync(admin, "Administrator");
    }

    private static HttpClient Client(WebApplicationFactory<Program> factory, string? role)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false,
        });
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Role", role);
        return client;
    }

    private static async Task<HttpClient> AdminClientAsync(WebApplicationFactory<Program> factory) =>
        await WithCsrfAsync(Client(factory, "Administrator"));

    private static async Task<HttpClient> AnonymousClientAsync(WebApplicationFactory<Program> factory) =>
        await WithCsrfAsync(Client(factory, null));

    private static async Task<HttpClient> WithCsrfAsync(HttpClient client)
    {
        using var csrf = await client.GetFromJsonAsync<JsonDocument>("/api/auth/csrf");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RootElement.GetProperty("token").GetString());
        return client;
    }

    private static async Task<JsonElement> Errors(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement.GetProperty("errors").Clone();

    private static JsonElement Department(JsonDocument list, Guid id) =>
        list.RootElement.EnumerateArray().Single(row => row.GetProperty("id").GetGuid() == id);

    private sealed class TestAuthentication(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-Role", out var role))
                return Task.FromResult(AuthenticateResult.NoResult());
            var user = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, "test-user"), new Claim(ClaimTypes.Role, role.ToString())],
                Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(user, Scheme.Name)));
        }
    }
}
