using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

public sealed class CrystalConnectionTests
{
    private const string Provider = "ODBC (RDO)";
    private static readonly CrystalDataSource Warehouse = new("PlantManager", "Warehouse", Provider);

    [Fact]
    public void InspectionCarriesTheReportsOwnPromptsAndDataSources()
    {
        var inspection = CrystalCatalog.ParseInspection("""
            {"prompts":[{"name":"Sub::Plant","label":"Plant (Sub)","kind":"Number","optional":false,
              "multiple":false,"range":true,"dynamic":true,"choices":[]}],
             "dataSources":[{"source":"PlantManager","database":"Warehouse","provider":"ODBC (RDO)"}]}
            """u8.ToArray());

        var prompt = Assert.Single(inspection.Prompts);
        Assert.Equal("Sub::Plant", prompt.Name);
        Assert.True(prompt.Range && prompt.Dynamic);
        Assert.Equal(Warehouse, Assert.Single(inspection.DataSources));
    }

    [Theory]
    [InlineData("""[{"name":"plant","label":"Plant","kind":"Number","choices":[]}]""")]
    [InlineData("""{"prompts":[]}""")]
    [InlineData("""{"prompts":[{"name":"plant"}],"dataSources":[]}""")]
    [InlineData("not json")]
    public void InspectionFromAnOlderWorkerIsRejected(string output)
    {
        var error = Assert.Throws<InvalidDataException>(() =>
            CrystalCatalog.ParseInspection(Encoding.UTF8.GetBytes(output)));
        Assert.Equal(CrystalCatalog.OutdatedWorker, error.Message);
    }

    [Fact]
    public void EachDataSourceResolvesToHowItSignsIn()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            // The first two use the original settings shape, without an Authentication value.
            ["Crystal:Connections:0:Source"] = "PlantManager",
            ["Crystal:Connections:0:Database"] = "Warehouse",
            ["Crystal:Connections:0:Provider"] = Provider,
            ["Crystal:Connections:0:IntegratedSecurity"] = "false",
            ["Crystal:Connections:0:User"] = "report_reader",
            ["Crystal:Connections:0:PasswordEnvironmentVariable"] = "EFI_TEST_PASSWORD",
            ["Crystal:Connections:1:Source"] = "Finance",
            ["Crystal:Connections:1:Database"] = "Ledger",
            ["Crystal:Connections:1:Provider"] = Provider,
            ["Crystal:Connections:1:IntegratedSecurity"] = "true",
            ["Crystal:Connections:2:Source"] = "Payroll",
            ["Crystal:Connections:2:Database"] = "HR",
            ["Crystal:Connections:2:Provider"] = Provider,
            ["Crystal:Connections:2:Authentication"] = "Prompt",
            ["Crystal:Connections:2:Name"] = "Payroll database",
        }).Build();
        var profiles = configuration.GetSection("Crystal:Connections").Get<CrystalConnection[]>()!;

        var connections = CrystalCatalog.Bind(
        [
            new("plantmanager", "WAREHOUSE", Provider),
            new("Finance", "Ledger", Provider),
            new("Payroll", "HR", Provider),
            new("Elsewhere", "Unknown", Provider),
            new("Elsewhere", "NoProvider", ""),
        ], profiles);

        // A configured "prompt" connection and an unlisted one both use an administrator's saved login.
        Assert.Equal(["stored", "integrated", "saved", "saved", "unconfigured"],
            connections.Select(connection => connection.Authentication));
        Assert.Equal(["WAREHOUSE", "Ledger", "Payroll database", "Unknown", "NoProvider"],
            connections.Select(connection => connection.Label));
        Assert.Equal(5, connections.Select(connection => connection.Id).Distinct().Count());
        Assert.Null(connections[2].Profile);
        Assert.Equal(new CrystalDataSource("Elsewhere", "Unknown", Provider), connections[3].Source);
        Assert.DoesNotContain(connections, connection =>
            connection.Id.Contains("report_reader") || connection.Label.Contains("report_reader"));
    }

    [Theory]
    [InlineData("Stored", "sa", "EFI_TEST_PASSWORD")]
    [InlineData("Stored", "", "EFI_TEST_PASSWORD")]
    [InlineData("Stored", "report_reader", null)]
    [InlineData("Kerberos", "report_reader", "EFI_TEST_PASSWORD")]
    public void UnusableConnectionSettingsFailClosed(string authentication, string user, string? variable)
    {
        var profile = new CrystalConnection("PlantManager", "Warehouse", Provider,
            User: user, PasswordEnvironmentVariable: variable, Authentication: authentication);
        var connection = Assert.Single(CrystalCatalog.Bind([Warehouse], [profile]));
        Assert.Equal("unconfigured", connection.Authentication);
        Assert.Null(connection.Profile);
    }

    [Fact]
    public void AmbiguousConnectionsAreNotGuessed()
    {
        var profile = new CrystalConnection("PlantManager", "Warehouse", Provider, IntegratedSecurity: true);
        var connection = Assert.Single(CrystalCatalog.Bind([Warehouse], [profile, profile with { Name = "Copy" }]));
        Assert.Equal("unconfigured", connection.Authentication);
    }

    [Fact]
    public void SavedCredentialsDoNotPrintTheirContents()
    {
        var text = new StoredCredential("reader", "secret-password").ToString();
        Assert.DoesNotContain("secret-password", text);
        Assert.DoesNotContain("reader", text);
    }

    [Fact]
    public void RepeatedRejectedSignInsAreThrottledUntilTheWindowPasses()
    {
        var now = DateTimeOffset.UnixEpoch;
        var throttle = new CredentialThrottle(() => now);
        for (var attempt = 0; attempt < CredentialThrottle.Limit; attempt++)
        {
            Assert.False(throttle.Blocked("user"));
            throttle.Record("user");
        }
        Assert.True(throttle.Blocked("user"));
        Assert.False(throttle.Blocked("someone-else"));
        now += CredentialThrottle.Window;
        Assert.False(throttle.Blocked("user"));

        throttle.Record("user");
        throttle.Reset("user");
        Assert.False(throttle.Blocked("user"));
    }

    [Fact]
    public async Task ASavedLoginReachesTheWorkerOnStandardInputOnly()
    {
        using var worker = new FakeWorker(exitCode: 0);
        worker.Store.Saved[ConnectionId] = new("report_user", "saved-secret");
        Environment.SetEnvironmentVariable("EFI_TEST_OTHER_PASSWORD", "other-stored-secret");
        try
        {
            var (status, body) = await worker.RenderAsync("saved");

            Assert.Equal(200, status);
            Assert.StartsWith("%PDF-", body);
            var input = await File.ReadAllTextAsync(worker.Captured("stdin.txt"));
            Assert.Contains("\"user\":\"report_user\"", input);
            Assert.Contains("\"password\":\"saved-secret\"", input);
            var environment = await File.ReadAllTextAsync(worker.Captured("env.txt"));
            Assert.DoesNotContain("saved-secret", environment);
            Assert.DoesNotContain("other-stored-secret", environment);
        }
        finally
        {
            Environment.SetEnvironmentVariable("EFI_TEST_OTHER_PASSWORD", null);
        }
    }

    [Fact]
    public async Task StoredSignInSendsOnlyTheNameOfItsProtectedVariable()
    {
        using var worker = new FakeWorker(exitCode: 0);
        Environment.SetEnvironmentVariable("EFI_TEST_STORED_PASSWORD", "stored-secret");
        try
        {
            var (status, _) = await worker.RenderAsync("stored");

            Assert.Equal(200, status);
            var input = await File.ReadAllTextAsync(worker.Captured("stdin.txt"));
            Assert.Contains("\"passwordEnvironmentVariable\":\"EFI_TEST_STORED_PASSWORD\"", input);
            Assert.DoesNotContain("stored-secret", input);
            Assert.Contains("EFI_TEST_STORED_PASSWORD=stored-secret",
                await File.ReadAllTextAsync(worker.Captured("env.txt")));
        }
        finally
        {
            Environment.SetEnvironmentVariable("EFI_TEST_STORED_PASSWORD", null);
        }
    }

    [Theory]
    [InlineData("saved", 7, 502, "datasource-signin-failed")]
    [InlineData("stored", 7, 502, "datasource-signin-failed")]
    [InlineData("stored", 6, 503, "datasource-needs-setup")]
    [InlineData("integrated", 4, 503, "datasource-needs-setup")]
    [InlineData("integrated", 5, 502, null)]
    public async Task ConnectionFailuresAreReportedWithoutConnectionDetails(
        string authentication, int exitCode, int expectedStatus, string? expectedCode)
    {
        using var worker = new FakeWorker(exitCode);
        worker.Store.Saved[ConnectionId] = new("report_user", "saved-secret");

        var (status, body) = await worker.RenderAsync(authentication);

        Assert.Equal(expectedStatus, status);
        using var problem = JsonDocument.Parse(body);
        Assert.Equal(expectedCode, problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null);
        foreach (var secret in new[] { "saved-secret", "report_user", "service_reader", "PlantManager", "EFI_TEST_STORED_PASSWORD" })
            Assert.DoesNotContain(secret, body);
        Assert.DoesNotContain(worker.Logs, entry => entry.Contains("saved-secret") || entry.Contains("report_user"));
    }

    [Fact]
    public async Task ReportsWithoutASavedLoginStopBeforeTheWorkerStarts()
    {
        using var worker = new FakeWorker(exitCode: 0);

        var (missingStatus, missing) = await worker.RenderAsync("saved");
        var (unconfiguredStatus, unconfigured) = await worker.RenderAsync("unconfigured");

        Assert.Equal(503, missingStatus);
        Assert.Contains("datasource-needs-setup", missing);
        Assert.Equal(503, unconfiguredStatus);
        Assert.Contains("datasource-needs-setup", unconfigured);
        Assert.False(File.Exists(worker.Captured("stdin.txt")));
    }

    [Fact]
    public async Task AnAdministratorsLoginIsTestedForThatDatabaseOnly()
    {
        using var worker = new FakeWorker(exitCode: 0);

        var failure = await worker.VerifyAsync(new("report_user", "typed-secret"));

        Assert.Null(failure);
        var input = await File.ReadAllTextAsync(worker.Captured("stdin.txt"));
        Assert.Contains("\"operation\":\"connect\"", input);
        Assert.Contains("\"password\":\"typed-secret\"", input);
        Assert.Contains("\"database\":\"Warehouse\"", input);
        Assert.DoesNotContain("\"database\":\"Other\"", input);
    }

    [Theory]
    [InlineData(" SA ", "secret")]
    [InlineData("", "secret")]
    [InlineData("reader", "")]
    public async Task UnusableLoginsAreRefusedBeforeTheWorkerStarts(string login, string password)
    {
        using var worker = new FakeWorker(exitCode: 0);
        var (status, body) = await worker.Execute((await worker.VerifyAsync(new(login, password)))!);
        Assert.Equal(400, status);
        Assert.Contains("credentials-invalid", body);
        Assert.False(File.Exists(worker.Captured("stdin.txt")));
    }

    [Fact]
    public async Task RejectedLoginsAreThrottledPerAdministrator()
    {
        using var worker = new FakeWorker(exitCode: 7);
        var credential = new StoredCredential("report_user", "typed-secret");
        for (var attempt = 0; attempt < CredentialThrottle.Limit; attempt++)
        {
            var (rejected, body) = await worker.Execute((await worker.VerifyAsync(credential))!);
            Assert.Equal(422, rejected);
            Assert.DoesNotContain("typed-secret", body);
        }

        var (status, throttled) = await worker.Execute((await worker.VerifyAsync(credential))!);
        Assert.Equal(429, status);
        Assert.Contains("credentials-throttled", throttled);
        Assert.Equal(422, (await worker.Execute((await worker.VerifyAsync(credential, "someone-else"))!)).Status);
    }

    private static string ConnectionId => CrystalCatalog.ConnectionId(Warehouse);

    private static CrystalBinding[] Connections(string authentication) =>
    [
        new(ConnectionId, "Warehouse", authentication, authentication is "integrated" or "stored"
            ? new CrystalConnection("PlantManager", "Warehouse", Provider,
                IntegratedSecurity: authentication == "integrated",
                User: authentication == "stored" ? "service_reader" : null,
                PasswordEnvironmentVariable: authentication == "stored" ? "EFI_TEST_STORED_PASSWORD" : null,
                Authentication: authentication)
            : null, Warehouse),
    ];

    /// <summary>Saved logins kept in memory for tests.</summary>
    internal sealed class MemoryCredentialStore : IReportCredentialStore
    {
        internal Dictionary<string, StoredCredential> Saved { get; } = [];

        public Task<IReadOnlyDictionary<string, StoredCredential>> GetAsync(IEnumerable<string> connectionIds,
            CancellationToken cancellation) =>
            Task.FromResult<IReadOnlyDictionary<string, StoredCredential>>(
                connectionIds.Where(Saved.ContainsKey).ToDictionary(id => id, id => Saved[id]));

        public Task<IReadOnlyList<SavedCredentialInfo>> ListAsync(CancellationToken cancellation) =>
            Task.FromResult<IReadOnlyList<SavedCredentialInfo>>(Saved.Select(item => new SavedCredentialInfo(
                item.Key, "", "", "", item.Value.Login, DateTimeOffset.UnixEpoch)).ToList());

        public Task SaveAsync(CrystalBinding connection, string login, string password, string updatedBy,
            CancellationToken cancellation)
        {
            Saved[connection.Id] = new(login, password);
            return Task.CompletedTask;
        }

        public Task<bool> DeleteAsync(string connectionId, CancellationToken cancellation) =>
            Task.FromResult(Saved.Remove(connectionId));
    }

    /// <summary>A stand-in worker that records what it was given and exits with a chosen code.</summary>
    private sealed class FakeWorker : IDisposable
    {
        private readonly DirectoryInfo directory = Directory.CreateTempSubdirectory("efi-hub-worker-test-");
        private readonly CrystalCatalog catalog;
        private readonly string template;
        private readonly string revision;
        private readonly ServiceProvider services = new ServiceCollection().AddLogging().BuildServiceProvider();
        private readonly RecordingLogger logger = new();

        internal FakeWorker(int exitCode)
        {
            var script = Path.Combine(directory.FullName, "worker.cmd");
            File.WriteAllText(script, string.Join("\r\n",
                "@echo off",
                "findstr \"^\" > \"%~dp0stdin.txt\"",
                "set > \"%~dp0env.txt\"",
                exitCode == 0 ? "echo %%PDF-1.4" : "echo Crystal worker: Sample (0x80004005) 1>&2",
                $"exit /b {exitCode}", ""));
            template = Path.Combine(directory.FullName, "report.rpt");
            File.WriteAllBytes(template, "template"u8.ToArray());
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Crystal:WorkerPath"] = script,
                ["Crystal:Connections:0:Source"] = "Other",
                ["Crystal:Connections:0:Database"] = "Other",
                ["Crystal:Connections:0:Provider"] = Provider,
                ["Crystal:Connections:0:User"] = "other_reader",
                ["Crystal:Connections:0:PasswordEnvironmentVariable"] = "EFI_TEST_OTHER_PASSWORD",
            }).Build();
            catalog = new CrystalCatalog(configuration, null!, logger, Store);
            revision = catalog.WorkerRevision(script)!;
        }

        internal MemoryCredentialStore Store { get; } = new();
        internal List<string> Logs => logger.Entries;
        internal string Captured(string name) => Path.Combine(directory.FullName, name);

        internal async Task<(int Status, string Body)> RenderAsync(string authentication)
        {
            var entry = new CrystalEntry("report", "Report", "Category", "version", [], template, directory.FullName,
                ["Employee"], DateTime.UtcNow, Convert.ToHexString(SHA256.HashData("template"u8)), revision,
                Connections(authentication));
            return await Execute(await catalog.RenderAsync(entry, new("version", [], Guid.NewGuid()),
                "test-user", CancellationToken.None));
        }

        internal Task<IResult?> VerifyAsync(StoredCredential credential, string subject = "admin") =>
            catalog.VerifyAsync("template"u8.ToArray(), Connections("saved")[0], credential, subject, CancellationToken.None);

        internal async Task<(int Status, string Body)> Execute(IResult result)
        {
            var context = new DefaultHttpContext { RequestServices = services };
            context.Response.Body = new MemoryStream();
            await result.ExecuteAsync(context);
            return (context.Response.StatusCode,
                Encoding.UTF8.GetString(((MemoryStream)context.Response.Body).ToArray()));
        }

        public void Dispose()
        {
            catalog.Dispose();
            services.Dispose();
            directory.Delete(recursive: true);
        }
    }

    private sealed class RecordingLogger : ILogger<CrystalCatalog>
    {
        internal List<string> Entries { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => NullLogger.Instance.BeginScope(state);
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lock (Entries) Entries.Add(formatter(state, exception) + exception);
        }
    }
}
