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
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

public sealed class ReportAssignmentTests
{
    private static readonly Guid Pouching = new("d3a1e0f0-0000-4000-8000-000000000009");
    private static readonly Guid Slitting = new("d3a1e0f0-0000-4000-8000-000000000008");
    private static readonly Guid Estimation = new("d3a1e0f0-0000-4000-8000-000000000018");

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData("Employee", HttpStatusCode.Forbidden)]
    public async Task OnlyAdministratorsManageDepartmentCollections(string? role, HttpStatusCode expected)
    {
        await using var factory = CreateFactory();
        using var client = Client(factory, role, "someone");
        using var listing = await client.GetAsync("/api/admin/report-assignments");
        Assert.Equal(expected, listing.StatusCode);
    }

    [Fact]
    public async Task ADepartmentCollectionGivesItsPeopleAccessWithoutTouchingTheLibraryOrOtherDepartments()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory);
        using var admin = await WithCsrfAsync(Client(factory, "Administrator", "admin"));
        using var pouchingWorker = Client(factory, "Employee", "pouch-1");
        using var slittingWorker = Client(factory, "Employee", "slit-1");

        // Before: the report is only for its configured role.
        Assert.Empty(await ReportIds(pouchingWorker));
        Assert.Equal(HttpStatusCode.NotFound, (await pouchingWorker.GetAsync("/api/reports/pouch-qc")).StatusCode);

        // Assign the same report to two departments.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsync($"/api/admin/departments/{Pouching}/reports/pouch-qc", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsync($"/api/admin/departments/{Estimation}/reports/pouch-qc", null)).StatusCode);
        // Dropping it again is harmless.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsync($"/api/admin/departments/{Pouching}/reports/pouch-qc", null)).StatusCode);

        Assert.Equal(["pouch-qc"], await ReportIds(pouchingWorker));
        Assert.Equal(HttpStatusCode.OK, (await pouchingWorker.GetAsync("/api/reports/pouch-qc")).StatusCode);
        using (var workspace = await pouchingWorker.GetFromJsonAsync<JsonDocument>("/api/workspace"))
            Assert.Single(workspace!.RootElement.GetProperty("reports").EnumerateArray());
        // Another department is unaffected.
        Assert.Empty(await ReportIds(slittingWorker));

        using (var listing = await admin.GetFromJsonAsync<JsonDocument>("/api/admin/report-assignments"))
        {
            // The library still lists every report.
            Assert.Equal(2, listing!.RootElement.GetProperty("reports").GetArrayLength());
            Assert.Equal(["pouch-qc"], Collection(listing, Pouching));
            Assert.Equal(["pouch-qc"], Collection(listing, Estimation));
        }

        // Move from Pouching to Slitting: Estimation keeps its copy.
        using var moved = await admin.PostAsJsonAsync("/api/admin/report-assignments/move",
            new { reportId = "pouch-qc", from = Pouching, to = Slitting });
        Assert.Equal(HttpStatusCode.NoContent, moved.StatusCode);
        Assert.Empty(await ReportIds(pouchingWorker));
        Assert.Equal(["pouch-qc"], await ReportIds(slittingWorker));
        using (var listing = await admin.GetFromJsonAsync<JsonDocument>("/api/admin/report-assignments"))
        {
            Assert.Empty(Collection(listing!, Pouching));
            Assert.Equal(["pouch-qc"], Collection(listing!, Slitting));
            Assert.Equal(["pouch-qc"], Collection(listing!, Estimation));
        }

        // Remove from Slitting: its people lose access; the report stays in the library.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/departments/{Slitting}/reports/pouch-qc")).StatusCode);
        Assert.Empty(await ReportIds(slittingWorker));
        using (var listing = await admin.GetFromJsonAsync<JsonDocument>("/api/admin/report-assignments"))
            Assert.Equal(2, listing!.RootElement.GetProperty("reports").GetArrayLength());
    }

    [Fact]
    public async Task AdministratorsSeeEveryReportAndUsersReachNothingOutsideTheirDepartment()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory);
        using var admin = await WithCsrfAsync(Client(factory, "Administrator", "admin"));
        // The folder role ("QualityReader") is irrelevant: administrators see the whole library.
        Assert.Equal(["pouch-qc", "slit-plan"], (await ReportIds(admin)).Order().ToArray());

        await admin.PutAsync($"/api/admin/departments/{Slitting}/reports/slit-plan", null);
        using var pouchingWorker = await WithCsrfAsync(Client(factory, "Employee", "pouch-1"));
        // Even holding the folder's configured role, a user outside the department gets nothing.
        using var roleHolder = Client(factory, "QualityReader", "pouch-1");
        Assert.Empty(await ReportIds(roleHolder));

        // Direct URLs and API calls to an unassigned report answer as if it did not exist.
        Assert.Equal(HttpStatusCode.NotFound, (await pouchingWorker.GetAsync("/api/reports/slit-plan")).StatusCode);
        using var render = await pouchingWorker.PostAsJsonAsync("/api/reports/slit-plan/render", new { version = "v1", values = new { } });
        Assert.Equal(HttpStatusCode.NotFound, render.StatusCode);
        using var view = await pouchingWorker.PostAsJsonAsync("/api/reports/slit-plan/view", new { interactionId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.NotFound, view.StatusCode);
        using var favorite = await pouchingWorker.PutAsJsonAsync("/api/workspace/favorites/slit-plan", new { favorite = true });
        Assert.Equal(HttpStatusCode.NotFound, favorite.StatusCode);
        // And the administration API stays closed to them.
        Assert.Equal(HttpStatusCode.Forbidden, (await pouchingWorker.PutAsync($"/api/admin/departments/{Pouching}/reports/slit-plan", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await pouchingWorker.GetAsync("/api/admin/users")).StatusCode);
    }

    [Fact]
    public async Task UnknownReportsAndDepartmentsAreRefused()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory);
        using var admin = await WithCsrfAsync(Client(factory, "Administrator", "admin"));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsync($"/api/admin/departments/{Pouching}/reports/missing", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsync($"/api/admin/departments/{Guid.NewGuid()}/reports/pouch-qc", null)).StatusCode);
        using var same = await admin.PostAsJsonAsync("/api/admin/report-assignments/move",
            new { reportId = "pouch-qc", from = Pouching, to = Pouching });
        Assert.Equal(HttpStatusCode.BadRequest, same.StatusCode);
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
                services.AddSingleton<ICrystalReportCatalog, FixedCatalog>();
                services.AddAuthentication(options => options.DefaultAuthenticateScheme = "Test")
                    .AddScheme<AuthenticationSchemeOptions, TestAuthentication>("Test", _ => { });
            });
        });
    }

    /// <summary>Two people: one in Pouching, one in Slitting.</summary>
    private static async Task SeedAsync(WebApplicationFactory<Program> factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        await db.Database.EnsureCreatedAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        foreach (var (id, department) in new[] { ("pouch-1", Pouching), ("slit-1", Slitting) })
        {
            await users.CreateAsync(new IdentityUser { Id = id, UserName = id, Email = $"{id}@plant.example" });
            db.UserProfiles.Add(new HubUserProfile { UserId = id, FullName = id, DepartmentId = department });
        }
        await db.SaveChangesAsync();
    }

    private static HttpClient Client(WebApplicationFactory<Program> factory, string? role, string user)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false,
        });
        if (role is not null)
        {
            client.DefaultRequestHeaders.Add("X-Test-Role", role);
            client.DefaultRequestHeaders.Add("X-Test-User", user);
        }
        return client;
    }

    private static async Task<HttpClient> WithCsrfAsync(HttpClient client)
    {
        using var csrf = await client.GetFromJsonAsync<JsonDocument>("/api/auth/csrf");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RootElement.GetProperty("token").GetString());
        return client;
    }

    private static async Task<string[]> ReportIds(HttpClient client)
    {
        using var reports = await client.GetFromJsonAsync<JsonDocument>("/api/reports");
        return reports!.RootElement.EnumerateArray().Select(row => row.GetProperty("id").GetString()!).ToArray();
    }

    private static string[] Collection(JsonDocument listing, Guid department) =>
        listing.RootElement.GetProperty("departments").EnumerateArray()
            .Single(row => row.GetProperty("id").GetGuid() == department)
            .GetProperty("reportIds").EnumerateArray().Select(id => id.GetString()!).ToArray();

    /// <summary>A published library of two reports, each limited by role to a reader role nobody here has.</summary>
    private sealed class FixedCatalog : ICrystalReportCatalog
    {
        public CrystalEntry[] Entries { get; } =
        [
            Entry("pouch-qc", "Pouch seal strength", "Quality"),
            Entry("slit-plan", "Slitting plan", "Production"),
        ];
        public bool Ready => true;
        public Microsoft.AspNetCore.Http.IResult OperatorStatus() => throw new NotSupportedException();
        public CrystalRoot[] Roots() => [];
        public CrystalBinding[] Bind(CrystalDataSource[] sources) => [];
        public void Rescan() { }
        public Task<CrystalInspection> InspectAsync(byte[] template, CancellationToken cancellation) => throw new NotSupportedException();
        public Task<Microsoft.AspNetCore.Http.IResult?> VerifyAsync(byte[] template, CrystalBinding connection,
            StoredCredential credential, string subject, CancellationToken cancellation) => throw new NotSupportedException();
        public Task<Microsoft.AspNetCore.Http.IResult> RenderAsync(CrystalEntry entry, CrystalRequest request, string subject,
            CancellationToken cancellation) => throw new NotSupportedException();
        public Task<string[]> NeedsSetupAsync(CrystalBinding[] connections, CancellationToken cancellation) => Task.FromResult(Array.Empty<string>());

        private static CrystalEntry Entry(string id, string name, string category) =>
            new(id, name, category, "v1", [], "", "", ["QualityReader"], DateTime.UtcNow, "", "", []);
    }

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
                [new Claim(ClaimTypes.NameIdentifier, Request.Headers["X-Test-User"].ToString()), new Claim(ClaimTypes.Role, role.ToString())],
                Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(user, Scheme.Name)));
        }
    }
}
