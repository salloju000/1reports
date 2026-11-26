using System.Net;
using System.Net.Http.Headers;
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

public sealed class OrganizationTests
{
    private const string Password = "Corrugated-Roll-2026!";
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];

    [Fact]
    public async Task AdministratorsSetTheNameAndLogoEveryoneSees()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory);
        using var admin = await ClientAsync(factory, "Administrator");

        using (var before = await admin.GetFromJsonAsync<JsonDocument>("/api/auth/me"))
        {
            var organization = before!.RootElement.GetProperty("organization");
            Assert.Equal(JsonValueKind.Null, organization.GetProperty("name").ValueKind);
            Assert.Equal(JsonValueKind.Null, organization.GetProperty("logo").ValueKind);
        }

        using var named = await admin.PutAsJsonAsync("/api/admin/organization", new { name = "  Shree Rama Packaging  " });
        Assert.Equal(HttpStatusCode.OK, named.StatusCode);

        using var logo = await admin.PutAsync("/api/admin/organization/logo", Image(Png, "logo.png"));
        Assert.Equal(HttpStatusCode.OK, logo.StatusCode);

        // Everyone signed in gets the name and a versioned logo address with their account.
        using var person = await ClientAsync(factory, "Employee");
        using var me = await person.GetFromJsonAsync<JsonDocument>("/api/auth/me");
        var saved = me!.RootElement.GetProperty("organization");
        Assert.Equal("Shree Rama Packaging", saved.GetProperty("name").GetString());
        var address = saved.GetProperty("logo").GetString()!;
        Assert.StartsWith("organization/logo?v=", address);

        using var image = await person.GetAsync($"/api/{address}");
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/png", image.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Png, await image.Content.ReadAsByteArrayAsync());
        Assert.Contains("max-age", image.Headers.CacheControl!.ToString());

        using var removed = await admin.DeleteAsync("/api/admin/organization/logo");
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await person.GetAsync("/api/organization/logo")).StatusCode);
    }

    [Fact]
    public async Task OnlyAdministratorsChangeIt()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory);
        using var person = await ClientAsync(factory, "Employee");
        using var name = await person.PutAsJsonAsync("/api/admin/organization", new { name = "Not mine" });
        Assert.Equal(HttpStatusCode.Forbidden, name.StatusCode);
        using var logo = await person.PutAsync("/api/admin/organization/logo", Image(Png, "logo.png"));
        Assert.Equal(HttpStatusCode.Forbidden, logo.StatusCode);
    }

    [Fact]
    public async Task LogosMustBeSmallRasterImages()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory);
        using var admin = await ClientAsync(factory, "Administrator");

        // An SVG (it can carry script) or anything else with an image name is refused by its content.
        using var svg = await admin.PutAsync("/api/admin/organization/logo",
            Image("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"u8.ToArray(), "logo.png"));
        Assert.Equal(HttpStatusCode.BadRequest, svg.StatusCode);

        var large = new byte[HubOrganization.MaxLogoBytes + 1];
        Png.CopyTo(large, 0);
        using var tooLarge = await admin.PutAsync("/api/admin/organization/logo", Image(large, "big.png"));
        Assert.Equal(HttpStatusCode.BadRequest, tooLarge.StatusCode);

        using var longName = await admin.PutAsJsonAsync("/api/admin/organization", new { name = new string('x', 101) });
        Assert.Equal(HttpStatusCode.BadRequest, longName.StatusCode);
    }

    [Theory]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }, "image/jpeg")]
    [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50 }, "image/webp")]
    [InlineData(new byte[] { 0x3C, 0x73, 0x76, 0x67 }, null)]
    [InlineData(new byte[] { 0x47, 0x49, 0x46, 0x38 }, null)]
    public void RecognisesImagesByContent(byte[] content, string? expected) =>
        Assert.Equal(expected, OrganizationEndpoints.ImageType(content));

    // ── Harness ──────────────────────────────────────────────────────────────

    private static MultipartFormDataContent Image(byte[] content, string name)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        return new MultipartFormDataContent { { file, "logo", name } };
    }

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

    private static async Task SeedAsync(WebApplicationFactory<Program> factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        await db.Database.EnsureCreatedAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var account = new IdentityUser { Id = "test-user", UserName = "admin", Email = "admin@plant.example", EmailConfirmed = true };
        Assert.True((await users.CreateAsync(account, Password)).Succeeded);
    }

    private static async Task<HttpClient> ClientAsync(WebApplicationFactory<Program> factory, string role)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false,
        });
        client.DefaultRequestHeaders.Add("X-Test-Role", role);
        using var csrf = await client.GetFromJsonAsync<JsonDocument>("/api/auth/csrf");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RootElement.GetProperty("token").GetString());
        return client;
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
