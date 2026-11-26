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

public sealed class AccountTests
{
    private const string Password = "Corrugated-Roll-2026!";

    [Fact]
    public async Task PreferencesAreSavedPerPersonAndReturnedWithTheirAccount()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory, withProfile: false);
        using var client = await SignedInAsync(factory);

        using (var before = await client.GetFromJsonAsync<JsonDocument>("/api/auth/me"))
        {
            Assert.Equal(JsonValueKind.Null, before!.RootElement.GetProperty("preferences").ValueKind);
            Assert.Equal("asha.patil", before.RootElement.GetProperty("userName").GetString());
        }

        using var invalid = await client.PutAsJsonAsync("/api/account/preferences", new { view = "tiles", density = "compact" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        // An account without a directory profile gets one on first save.
        using var saved = await client.PutAsJsonAsync("/api/account/preferences", new { view = "grid", density = "compact" });
        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);
        using var after = await client.GetFromJsonAsync<JsonDocument>("/api/auth/me");
        var preferences = after!.RootElement.GetProperty("preferences");
        Assert.Equal("grid", preferences.GetProperty("view").GetString());
        Assert.Equal("compact", preferences.GetProperty("density").GetString());
    }

    [Fact]
    public async Task PeopleChangeTheirOwnPasswordOnlyWithTheCurrentOne()
    {
        await using var factory = CreateFactory();
        await SeedAsync(factory, withProfile: true);
        using var client = await SignedInAsync(factory);

        using var wrong = await client.PostAsJsonAsync("/api/account/password",
            new { currentPassword = "not-my-password", newPassword = "Laminated-Pouch-2027!" });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.True((await Errors(wrong)).TryGetProperty("currentPassword", out _));

        using var weak = await client.PostAsJsonAsync("/api/account/password",
            new { currentPassword = Password, newPassword = "short" });
        Assert.True((await Errors(weak)).TryGetProperty("newPassword", out _));

        using var same = await client.PostAsJsonAsync("/api/account/password",
            new { currentPassword = Password, newPassword = Password });
        Assert.True((await Errors(same)).TryGetProperty("newPassword", out _));

        using var changed = await client.PostAsJsonAsync("/api/account/password",
            new { currentPassword = Password, newPassword = "Laminated-Pouch-2027!" });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var account = (await users.FindByIdAsync("asha"))!;
        Assert.True(await users.CheckPasswordAsync(account, "Laminated-Pouch-2027!"));
        Assert.False(await users.CheckPasswordAsync(account, Password));
    }

    [Fact]
    public async Task AccountSettingsNeedASignedInPerson()
    {
        await using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        using var response = await client.PutAsJsonAsync("/api/account/preferences", new { view = "list", density = "compact" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
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

    private static async Task SeedAsync(WebApplicationFactory<Program> factory, bool withProfile)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        await db.Database.EnsureCreatedAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var account = new IdentityUser { Id = "asha", UserName = "asha.patil", Email = "asha@plant.example", EmailConfirmed = true };
        Assert.True((await users.CreateAsync(account, Password)).Succeeded);
        if (withProfile)
        {
            db.UserProfiles.Add(new HubUserProfile { UserId = "asha", FullName = "Asha Patil" });
            await db.SaveChangesAsync();
        }
    }

    private static async Task<HttpClient> SignedInAsync(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false,
        });
        client.DefaultRequestHeaders.Add("X-Test-User", "asha");
        using var csrf = await client.GetFromJsonAsync<JsonDocument>("/api/auth/csrf");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.RootElement.GetProperty("token").GetString());
        return client;
    }

    private static async Task<JsonElement> Errors(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonDocument>())!.RootElement.GetProperty("errors").Clone();

    private sealed class TestAuthentication(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-User", out var user))
                return Task.FromResult(AuthenticateResult.NoResult());
            var principal = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, user.ToString()), new Claim(ClaimTypes.Role, "Employee")], Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
        }
    }
}
