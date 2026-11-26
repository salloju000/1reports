using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

public sealed class SqlAuthorizationTests
{
    // A user's access comes only from their department's report collection: the role configured on the
    // publishing folder ("InventoryReader") no longer grants anything by itself.
    [Theory]
    [InlineData("Employee", false)]
    [InlineData("InventoryReader", false)]
    [InlineData("Employee", true)]
    public async Task ReportAccessAndRenderValidationFollowTheDepartmentCollection(string role, bool assigned)
    {
        var canAccess = assigned;
        using var factory = CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ICrystalReportCatalog, TestReportCatalog>()));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
            var printing = new Guid("d3a1e0f0-0000-4000-8000-000000000006");
            await db.Database.EnsureCreatedAsync();
            db.Users.Add(new Microsoft.AspNetCore.Identity.IdentityUser { Id = "test-user", UserName = "test-user" });
            db.UserProfiles.Add(new HubUserProfile { UserId = "test-user", FullName = "Test", DepartmentId = printing });
            if (assigned) db.DepartmentReports.Add(new HubDepartmentReport(printing, "inventory", DateTimeOffset.UtcNow, "admin"));
            await db.SaveChangesAsync();
        }
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });
        client.DefaultRequestHeaders.Add("X-Test-Role", role);
        using var listing = await client.GetFromJsonAsync<JsonDocument>("/api/reports");
        Assert.Equal(canAccess ? 1 : 0, listing!.RootElement.GetArrayLength());

        const string report = "/api/reports/inventory";
        using var detail = await client.GetAsync(report);
        Assert.Equal(canAccess ? HttpStatusCode.OK : HttpStatusCode.NotFound, detail.StatusCode);
        if (canAccess)
        {
            using var body = await detail.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.Equal("current", body!.RootElement.GetProperty("version").GetString());
            Assert.False(body.RootElement.GetProperty("setupRequired").GetBoolean());
            Assert.False(body.RootElement.GetProperty("canConfigure").GetBoolean());
            Assert.Single(body.RootElement.GetProperty("prompts").EnumerateArray());
            // People who are not administrators learn nothing about the report's databases.
            Assert.Empty(body.RootElement.GetProperty("connections").EnumerateArray());
            Assert.DoesNotContain("PlantManager", body.RootElement.GetRawText());
        }

        using var csrf = await client.GetFromJsonAsync<JsonDocument>("/api/auth/csrf");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RootElement.GetProperty("token").GetString());
        using var stale = await client.PostAsJsonAsync(report + "/render", new { version = "old", values = new { } });
        Assert.Equal(canAccess ? HttpStatusCode.Conflict : HttpStatusCode.NotFound, stale.StatusCode);
        using var invalid = await client.PostAsJsonAsync(report + "/render", new { version = "current", values = new { } });
        Assert.Equal(canAccess ? HttpStatusCode.BadRequest : HttpStatusCode.NotFound, invalid.StatusCode);
        if (canAccess)
        {
            using var problem = await invalid.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.True(problem!.RootElement.GetProperty("errors").TryGetProperty("plant", out _));
        }
    }

    [Fact]
    public async Task ReportRenderHonorsCancellationBeforeStartingTheWorker()
    {
        using var factory = CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ICrystalReportCatalog, TestReportCatalog>()));
        var catalog = factory.Services.GetRequiredService<ICrystalReportCatalog>();
        var entry = Assert.Single(catalog.Entries);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var values = new Dictionary<string, JsonElement> { ["plant"] = JsonSerializer.SerializeToElement("1") };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            catalog.RenderAsync(entry, new(entry.Version, values, Guid.NewGuid()), "test-user", cancellation.Token));
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData("Employee", HttpStatusCode.Forbidden)]
    [InlineData("InventoryReader", HttpStatusCode.Forbidden)]
    public async Task OnlyAdministratorsReachReportDatabaseSetupAndUploads(string? role, HttpStatusCode expected)
    {
        using var factory = CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ICrystalReportCatalog, TestReportCatalog>()));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Role", role);
        foreach (var (method, route) in new[]
        {
            (HttpMethod.Get, "/api/admin/report-databases"),
            (HttpMethod.Put, "/api/admin/report-databases/warehouse"),
            (HttpMethod.Delete, "/api/admin/report-databases/warehouse"),
            (HttpMethod.Get, "/api/admin/report-folders"),
            (HttpMethod.Post, "/api/admin/report-uploads"),
        })
        {
            using var request = new HttpRequestMessage(method, route);
            if (method == HttpMethod.Put) request.Content = JsonContent.Create(new { login = "reader", password = "placeholder" });
            using var response = await client.SendAsync(request);
            Assert.Equal(expected, response.StatusCode);
        }
    }

    [Theory]
    [InlineData("report.rpt", true)]
    [InlineData("Stock Details 1-11-2026.RPT", true)]
    [InlineData("..\\report.rpt", false)]
    [InlineData("folder/report.rpt", false)]
    [InlineData(".rpt", false)]
    [InlineData("report.exe", false)]
    [InlineData("", false)]
    public void UploadedReportNamesStayInsideTheReportFolder(string name, bool valid) =>
        Assert.Equal(valid, ReportAdminEndpoints.ValidFileName(name));

    [Fact]
    public async Task FavoriteMutationRequiresSignInCsrfAndExplicitState()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });
        const string route = "/api/workspace/favorites/report";
        using var anonymous = await client.PutAsJsonAsync(route, new { favorite = true });
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        client.DefaultRequestHeaders.Add("X-Test-Role", "Employee");
        using var missingCsrf = await client.PutAsJsonAsync(route, new { favorite = true });
        Assert.Equal(HttpStatusCode.BadRequest, missingCsrf.StatusCode);

        using var csrf = await client.GetFromJsonAsync<JsonDocument>("/api/auth/csrf");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RootElement.GetProperty("token").GetString());
        using var missingState = await client.PutAsJsonAsync(route, new { });
        Assert.Equal(HttpStatusCode.BadRequest, missingState.StatusCode);
        Assert.Contains("\"favorite\"", await missingState.Content.ReadAsStringAsync());
        using var unavailable = await client.PutAsJsonAsync(route, new { favorite = false });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, unavailable.StatusCode);
    }

    [Theory]
    [InlineData(null, null, HttpStatusCode.Unauthorized)]
    [InlineData("Employee", null, HttpStatusCode.Forbidden)]
    [InlineData("Administrator", null, HttpStatusCode.BadRequest)]
    [InlineData("Administrator", "invalid-token", HttpStatusCode.BadRequest)]
    public async Task SqlCheckRejectsRequestsBeforeConnecting(
        string? role, string? token, HttpStatusCode expected)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });
        if (token is not null)
        {
            using var csrfRequest = new HttpRequestMessage(HttpMethod.Get, "/api/auth/csrf");
            csrfRequest.Headers.Add("X-Test-Role", role);
            using var csrfResponse = await client.SendAsync(csrfRequest);
            Assert.Equal(HttpStatusCode.OK, csrfResponse.StatusCode);
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/sql/check")
        {
            Content = JsonContent.Create(new { database = "test", login = "reader", password = "placeholder" }),
        };
        if (role is not null) request.Headers.Add("X-Test-Role", role);
        if (token is not null) request.Headers.Add("X-CSRF-TOKEN", token);

        using var response = await client.SendAsync(request);
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task AnonymousFrontendLoadsWhileApisRemainProtectedUnderApplicationPath()
    {
        var webRoot = Directory.CreateTempSubdirectory("efi-hub-test-");
        try
        {
            Directory.CreateDirectory(Path.Combine(webRoot.FullName, "assets"));
            await File.WriteAllTextAsync(Path.Combine(webRoot.FullName, "index.html"), "<title>EFI Reporting Hub</title>");
            await File.WriteAllTextAsync(Path.Combine(webRoot.FullName, "assets", "index-test.js"), "console.log('hub');");
            await File.WriteAllTextAsync(Path.Combine(webRoot.FullName, "assets", "pdf.worker-test.mjs"), "export {};");
            Directory.CreateDirectory(Path.Combine(webRoot.FullName, "api", "auth"));
            await File.WriteAllTextAsync(Path.Combine(webRoot.FullName, "api", "auth", "probe.js"), "must not be served");

            using var factory = CreateFactory().WithWebHostBuilder(builder =>
            {
                builder.UseWebRoot(webRoot.FullName);
                builder.ConfigureTestServices(services => services.AddTransient<IStartupFilter, ApplicationPath>());
            });
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("https://localhost"),
                AllowAutoRedirect = false,
            });
            foreach (var path in new[] { "/1Reports/", "/1Reports/index.html" })
            {
                using var page = await client.GetAsync(path);
                Assert.Equal(HttpStatusCode.OK, page.StatusCode);
                Assert.Equal("text/html", page.Content.Headers.ContentType?.MediaType);
                Assert.Contains("EFI Reporting Hub", await page.Content.ReadAsStringAsync());
            }
            using var asset = await client.GetAsync("/1Reports/assets/index-test.js");
            Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
            Assert.Equal("console.log('hub');", await asset.Content.ReadAsStringAsync());
            // The report viewer's PDF worker is an ES module (.mjs) and must be served as JavaScript.
            using var module = await client.GetAsync("/1Reports/assets/pdf.worker-test.mjs");
            Assert.Equal(HttpStatusCode.OK, module.StatusCode);
            Assert.Contains("javascript", module.Content.Headers.ContentType?.MediaType);

            using var me = await client.GetAsync("/1Reports/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
            using var anonymousReports = await client.GetAsync("/1Reports/api/reports");
            Assert.Equal(HttpStatusCode.Unauthorized, anonymousReports.StatusCode);
            using var authorizedReports = new HttpRequestMessage(HttpMethod.Get, "/1Reports/api/reports");
            authorizedReports.Headers.Add("X-Test-Role", "Administrator");
            using var catalog = await client.SendAsync(authorizedReports);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, catalog.StatusCode);
            using var statusRequest = new HttpRequestMessage(HttpMethod.Get, "/1Reports/api/reports/status");
            statusRequest.Headers.Add("X-Test-Role", "Administrator");
            using var status = await client.SendAsync(statusRequest);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, status.StatusCode);
            Assert.Contains("\"ready\":false", await status.Content.ReadAsStringAsync());
            using var apiAsset = await client.GetAsync("/1Reports/api/auth/probe.js");
            Assert.Equal(HttpStatusCode.Unauthorized, apiAsset.StatusCode);
            using var sql = await client.PostAsJsonAsync("/1Reports/api/sql/check", new { database = "test" });
            Assert.Equal(HttpStatusCode.Unauthorized, sql.StatusCode);
        }
        finally
        {
            webRoot.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task CsrfEndpointUsesTheApplicationPathBaseAndSecureCookie()
    {
        using var factory = CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddTransient<IStartupFilter, ApplicationPath>()));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false,
        });
        using var response = await client.GetAsync("/1Reports/api/auth/csrf");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith("__Host-EfiHub-Csrf=", cookie);
        Assert.Contains("path=/;", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseContentRoot(Path.GetFullPath("../../../../server", AppContext.BaseDirectory));
            builder.UseEnvironment("Development");
            builder.ConfigureTestServices(services =>
            {
                // Report access also consults department collections, so the endpoints need a database.
                services.UseInMemoryHub();
                services.AddAuthentication(options =>
                {
                    options.DefaultAuthenticateScheme = "Test";
                }).AddScheme<AuthenticationSchemeOptions, TestAuthentication>("Test", _ => { });
            });
        });

    private sealed class ApplicationPath : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.UsePathBase("/1Reports");
            next(app);
        };
    }

    private sealed class TestReportCatalog(CrystalCatalog catalog) : ICrystalReportCatalog
    {
        public CrystalEntry[] Entries { get; } =
        [
            new("inventory", "Inventory label", "Inventory", "current",
                [new("plant", "Plant", "Number", false, false, false, [])],
                "", "", ["InventoryReader"], DateTime.UtcNow, "", "",
                [new("warehouse", "Warehouse", "integrated", new("PlantManager", "Warehouse", "ODBC (RDO)",
                    IntegratedSecurity: true, User: "never-shown"), new("PlantManager", "Warehouse", "ODBC (RDO)"))]),
        ];
        public bool Ready => true;
        public Microsoft.AspNetCore.Http.IResult OperatorStatus() => catalog.OperatorStatus();
        public CrystalRoot[] Roots() => [];
        public CrystalBinding[] Bind(CrystalDataSource[] sources) => catalog.Bind(sources);
        public void Rescan() { }
        public Task<CrystalInspection> InspectAsync(byte[] template, CancellationToken cancellation) =>
            catalog.InspectAsync(template, cancellation);
        public Task<Microsoft.AspNetCore.Http.IResult?> VerifyAsync(byte[] template, CrystalBinding connection,
            StoredCredential credential, string subject, CancellationToken cancellation) =>
            catalog.VerifyAsync(template, connection, credential, subject, cancellation);
        public Task<Microsoft.AspNetCore.Http.IResult> RenderAsync(
            CrystalEntry entry, CrystalRequest request, string subject, CancellationToken cancellation) =>
            catalog.RenderAsync(entry, request, subject, cancellation);
        public Task<string[]> NeedsSetupAsync(CrystalBinding[] connections, CancellationToken cancellation) =>
            catalog.NeedsSetupAsync(connections, cancellation);
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
                [new Claim(ClaimTypes.NameIdentifier, "test-user"), new Claim(ClaimTypes.Role, role.ToString())],
                Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(user, Scheme.Name)));
        }
    }
}
