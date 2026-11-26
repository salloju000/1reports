using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;

internal sealed record CrystalPrompt(string Name, string Label, string Kind, bool Optional,
    bool Multiple, bool Range, string[] Choices, bool Dynamic = false);
internal sealed record CrystalDataSource(string Source, string Database, string Provider);
internal sealed record CrystalInspection(CrystalPrompt[] Prompts, CrystalDataSource[] DataSources);
/// <summary>
/// One data source read from a report and how it signs in: "integrated" and "stored" come from
/// host configuration, "saved" uses the login an administrator saved in the Hub database, and
/// "unconfigured" cannot be used (ambiguous or unusable settings, or no provider).
/// </summary>
internal sealed record CrystalBinding(string Id, string Label, string Authentication, CrystalConnection? Profile,
    CrystalDataSource Source);
internal sealed record CrystalEntry(string Id, string Name, string Category, string Version,
    CrystalPrompt[] Prompts, string Path, string Root, string[] Roles, DateTime UpdatedAt,
    string TemplateHash, string WorkerRevision, CrystalBinding[] Connections);
internal sealed record CrystalRequest(string Version, Dictionary<string, JsonElement> Values, Guid? InteractionId,
    string? Format = null)
{
    /// <summary>"pdf" (the default, the report's print layout) or "xlsx" (its data as an Excel workbook).</summary>
    internal string Output => string.IsNullOrEmpty(Format) ? "pdf" : Format;
}
/// <summary>A configured publishing folder. Uploads go only to roots without a pinned approved file.</summary>
internal sealed record CrystalRoot(string Key, string Category, string Path, bool Uploadable);

internal interface ICrystalReportCatalog
{
    CrystalEntry[] Entries { get; }
    bool Ready { get; }
    IResult OperatorStatus();
    CrystalRoot[] Roots();
    CrystalBinding[] Bind(CrystalDataSource[] sources);
    void Rescan();
    Task<CrystalInspection> InspectAsync(byte[] template, CancellationToken cancellation);
    /// <summary>Signs in to one data source of a template; null when the database accepts the login.</summary>
    Task<IResult?> VerifyAsync(byte[] template, CrystalBinding connection, StoredCredential credential,
        string subject, CancellationToken cancellation);
    Task<IResult> RenderAsync(CrystalEntry entry, CrystalRequest request, string subject, CancellationToken cancellation);
    /// <summary>The ids of connections that cannot sign in yet (unusable, or no saved login).</summary>
    Task<string[]> NeedsSetupAsync(CrystalBinding[] connections, CancellationToken cancellation);
}

internal sealed class CrystalCatalog(IConfiguration configuration, IWebHostEnvironment environment,
    ILogger<CrystalCatalog> logger, IReportCredentialStore? credentials = null)
    : BackgroundService, ICrystalReportCatalog
{
    private readonly SemaphoreSlim rescan = new(0, 1);
    private readonly SemaphoreSlim renders = new(2);
    private readonly Dictionary<string, CrystalInspection> metadata = new();
    private readonly CredentialThrottle throttle = new(() => DateTimeOffset.UtcNow);
    private sealed record Snapshot(CrystalEntry[] Entries, bool Ready, string[] Rejected, string[] Unconfigured,
        DateTimeOffset? ScannedAt);
    private Snapshot snapshot = new([], false, [], [], null);
    internal const string OutdatedWorker = "The Crystal worker is out of date.";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public CrystalEntry[] Entries => Volatile.Read(ref snapshot).Entries;
    public bool Ready => Volatile.Read(ref snapshot).Ready;
    public IResult OperatorStatus()
    {
        var current = Volatile.Read(ref snapshot);
        var body = new
        {
            current.Ready, available = current.Entries.Length, current.Rejected, current.Unconfigured, current.ScannedAt,
        };
        return Results.Json(body, statusCode: current.Ready ? 200 : 503);
    }

    /// <summary>Asks for a catalog scan now instead of at the next minute, for example after an upload.</summary>
    public void Rescan()
    {
        try { rescan.Release(); } catch (SemaphoreFullException) { }
    }

    public CrystalRoot[] Roots() =>
        configuration.GetSection("Crystal:Roots").GetChildren().Where(root => !string.IsNullOrWhiteSpace(root["Path"]))
            .Select(root => new CrystalRoot(root.Key, root["Category"] ?? root.Key, Path.GetFullPath(root["Path"]!),
                root["ApprovedFile"] is null && root["ApprovedSha256"] is null
                && (root.GetSection("Roles").Get<string[]>() ?? []).Length > 0))
            .ToArray();

    public CrystalBinding[] Bind(CrystalDataSource[] sources) =>
        Bind(sources, configuration.GetSection("Crystal:Connections").Get<CrystalConnection[]>() ?? []);

    public async Task<CrystalInspection> InspectAsync(byte[] template, CancellationToken cancellation) =>
        ParseInspection(await InvokeAsync("inspect", template, null, [], cancellation));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        do
        {
            var next = new List<CrystalEntry>();
            var rejected = new List<string>();
            var unconfigured = new List<string>();
            var profiles = configuration.GetSection("Crystal:Connections").Get<CrystalConnection[]>() ?? [];
            var hashes = new HashSet<string>();
            var rootsScanned = 0;
            var worker = configuration["Crystal:WorkerPath"];
            var workerRevision = WorkerRevision(worker);
            if (workerRevision is null) rejected.Add("The worker executable is unavailable.");
            foreach (var root in configuration.GetSection("Crystal:Roots").GetChildren())
            {
                try
                {
                    var rootEntries = new List<CrystalEntry>();
                    var directory = Path.GetFullPath(root["Path"]!);
                    var roles = root.GetSection("Roles").Get<string[]>() ?? [];
                    if (roles.Length == 0 || !SafePath(directory, directory))
                        throw new InvalidOperationException("The publishing root must have roles and a safe path.");
                    var webRoot = environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot");
                    if (Within(Path.GetFullPath(webRoot), directory) || Within(directory, Path.GetFullPath(webRoot)))
                        throw new InvalidOperationException("Publishing roots must be outside the web root.");
                    var approvedFile = root["ApprovedFile"];
                    var approvedHash = root["ApprovedSha256"];
                    var files = PublishingFiles(directory, approvedFile, approvedHash);
                    foreach (var path in files)
                    {
                        stoppingToken.ThrowIfCancellationRequested();
                        try
                        {
                            if (!SafePath(directory, path)) throw new InvalidDataException("Unsafe report path.");
                            var relative = Path.GetRelativePath(directory, path).Replace('\\', '/');
                            var id = ReportId(configuration, root.Key, relative);
                            var bytes = ReadTemplate(path);
                            var templateHash = Convert.ToHexString(SHA256.HashData(bytes));
                            if (!MatchesApproval(templateHash, approvedHash))
                                throw new InvalidDataException("The template differs from the approved SHA-256.");
                            if (workerRevision is null) continue;
                            var version = Fingerprint(templateHash + workerRevision);
                            if (!metadata.TryGetValue(version, out var inspection))
                            {
                                inspection = ParseInspection(await InvokeAsync("inspect", bytes, null, [], stoppingToken));
                                metadata[version] = inspection;
                            }
                            hashes.Add(version);
                            var connections = Bind(inspection.DataSources, profiles);
                            if (connections.Any(connection => connection.Authentication == "unconfigured"))
                                unconfigured.Add($"{root.Key}/{Path.GetFileName(path)}");
                            rootEntries.Add(new(id, Path.GetFileNameWithoutExtension(path),
                                root["Category"] ?? root.Key, version, inspection.Prompts, path, directory, roles,
                                File.GetLastWriteTimeUtc(path), templateHash, workerRevision, connections));
                        }
                        catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                        {
                            rejected.Add($"{root.Key}/{Path.GetFileName(path)}: {FailureReason(error)}");
                            logger.LogWarning("Crystal inspection failed for {Report} ({Reason}).",
                                Path.GetFileName(path), FailureReason(error));
                        }
                    }
                    next.AddRange(rootEntries);
                    rootsScanned++;
                }
                catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                {
                    rejected.Add($"{root.Key}: {error.GetType().Name}");
                    logger.LogWarning("Crystal publishing root {Root} could not be scanned ({ErrorType}).",
                        root.Key, error.GetType().Name);
                }
            }
            var duplicates = next.GroupBy(entry => entry.Id).Where(group => group.Count() > 1)
                .Select(group => group.Key).ToHashSet();
            if (duplicates.Count > 0) rejected.Add("Duplicate report identifiers.");
            var available = next.Where(entry => !duplicates.Contains(entry.Id)).OrderBy(entry => entry.Name).ToArray();
            Volatile.Write(ref snapshot, new(available,
                IsScanReady(rootsScanned, workerRevision is not null, available.Length, rejected.Count),
                rejected.ToArray(), unconfigured.ToArray(), DateTimeOffset.UtcNow));
            foreach (var hash in metadata.Keys.Where(hash => !hashes.Contains(hash)).ToArray())
                metadata.Remove(hash);
            try { await rescan.WaitAsync(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (OperationCanceledException) { return; }
        } while (!stoppingToken.IsCancellationRequested);
    }

    internal static bool IsScanReady(int rootsScanned, bool workerAvailable, int available, int rejected) =>
        rootsScanned > 0 && workerAvailable && (available > 0 || rejected == 0);

    internal string? WorkerRevision(string? path)
    {
        if (string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path) || !File.Exists(path)) return null;
        var settings = configuration.GetSection("Crystal:Connections").AsEnumerable()
            .OrderBy(setting => setting.Key, StringComparer.Ordinal).ToArray();
        try
        {
            var executable = new FileInfo(path);
            return Fingerprint(JsonSerializer.Serialize(new { path, executable.LastWriteTimeUtc, executable.Length, settings }));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string Fingerprint(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    internal static string ReportId(IConfiguration configuration, string root, string relativePath)
    {
        var path = root + "/" + relativePath;
        var keys = configuration.GetSection("Crystal:ReportIds").GetChildren()
            .Where(item => string.Equals(item.Value, path, StringComparison.OrdinalIgnoreCase))
            .Select(item => item.Key).ToArray();
        if (keys.Length > 1) throw new InvalidDataException("Multiple stable IDs are assigned to the report.");
        return Fingerprint(keys.SingleOrDefault() ?? root + "/" + relativePath.ToUpperInvariant());
    }

    internal static IEnumerable<string> PublishingFiles(string directory, string? approvedFile, string? approvedHash)
    {
        if (approvedFile is null && approvedHash is null)
            return Directory.EnumerateFiles(directory, "*.rpt", new EnumerationOptions
            {
                RecurseSubdirectories = true,
                IgnoreInaccessible = false,
                AttributesToSkip = FileAttributes.ReparsePoint,
            });

        if (string.IsNullOrWhiteSpace(approvedFile) || approvedFile != Path.GetFileName(approvedFile) ||
            approvedFile.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            !Path.GetExtension(approvedFile).Equals(".rpt", StringComparison.OrdinalIgnoreCase) ||
            approvedHash is not { Length: 64 } || !approvedHash.All(Uri.IsHexDigit))
            throw new InvalidDataException("Configure both a root-level .rpt file and its approved SHA-256.");

        return [Path.Combine(directory, approvedFile)];
    }

    internal static bool MatchesApproval(string version, string? approvedHash) =>
        approvedHash is null || version.Equals(approvedHash, StringComparison.OrdinalIgnoreCase);

    internal static CrystalInspection ParseInspection(byte[] json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Object &&
                document.RootElement.Deserialize<CrystalInspection>(Json) is { Prompts: not null, DataSources: not null } result &&
                result.Prompts.All(prompt => prompt is { Name: not null, Label: not null, Kind: not null, Choices: not null }) &&
                result.DataSources.All(source => source is { Source: not null, Database: not null, Provider: not null }))
                return result;
        }
        catch (JsonException) { }
        throw new InvalidDataException(OutdatedWorker);
    }

    /// <summary>
    /// Resolves each data source stored in a report to how it signs in. A source with exactly one
    /// matching integrated or stored connection in host configuration uses it; a source with no
    /// matching connection, or one set to "prompt"/"saved", uses the login an administrator saved
    /// for it ("saved"). Ambiguous or unusable configuration, or a source without a provider,
    /// fails closed as "unconfigured" instead of being guessed.
    /// </summary>
    internal static CrystalBinding[] Bind(CrystalDataSource[] sources, CrystalConnection[] profiles) =>
        sources.Select(source =>
        {
            var matches = profiles.Where(profile => Same(profile.Source, source.Source)
                && Same(profile.Database, source.Database) && Same(profile.Provider, source.Provider)).ToArray();
            var profile = matches.Length == 1 ? matches[0] : null;
            var mode = string.IsNullOrWhiteSpace(source.Provider) || matches.Length > 1 ? "unconfigured"
                : profile is null ? "saved"
                : Authentication(profile);
            var label = !string.IsNullOrWhiteSpace(profile?.Name) ? profile.Name.Trim()
                : !string.IsNullOrWhiteSpace(source.Database) ? source.Database : "Report database";
            return new CrystalBinding(ConnectionId(source), label, mode,
                mode is "integrated" or "stored" ? profile : null, source);
        }).ToArray();

    internal static string ConnectionId(CrystalDataSource source) =>
        Fingerprint($"{source.Source}\n{source.Database}\n{source.Provider}".ToUpperInvariant())[..16];

    /// <summary>
    /// "integrated" signs in as the Hub's Windows identity, "stored" uses a service login whose
    /// password is held in protected host configuration, and "saved" (also configured as
    /// "prompt") uses the login an administrator saved in the Hub.
    /// </summary>
    internal static string Authentication(CrystalConnection profile)
    {
        var mode = profile.Authentication?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(mode)) mode = profile.IntegratedSecurity ? "integrated" : "stored";
        return mode switch
        {
            "integrated" => mode,
            "prompt" or "saved" => "saved",
            "stored" when !string.IsNullOrWhiteSpace(profile.User) && !IsAdministratorLogin(profile.User)
                && !string.IsNullOrWhiteSpace(profile.PasswordEnvironmentVariable) => mode,
            _ => "unconfigured",
        };
    }

    private static bool Same(string? left, string? right) =>
        string.Equals(left ?? "", right ?? "", StringComparison.OrdinalIgnoreCase);

    internal static bool IsAdministratorLogin(string login) =>
        string.Equals(login.Trim(), "sa", StringComparison.OrdinalIgnoreCase);

    public async Task<string[]> NeedsSetupAsync(CrystalBinding[] connections, CancellationToken cancellation)
    {
        var (unconfigured, missing, _) = await ReadinessAsync(connections, cancellation);
        return [.. unconfigured, .. missing];
    }

    /// <summary>
    /// Works out which of a report's connections can sign in now. Returns the ids of unusable
    /// connections, of "saved" connections that have no saved login yet, and the saved logins.
    /// </summary>
    internal async Task<(string[] Unconfigured, string[] Missing, IReadOnlyDictionary<string, StoredCredential> Saved)>
        ReadinessAsync(CrystalBinding[] connections, CancellationToken cancellation)
    {
        var unconfigured = connections.Where(connection => connection.Authentication == "unconfigured")
            .Select(connection => connection.Id).ToArray();
        var wanted = connections.Where(connection => connection.Authentication == "saved")
            .Select(connection => connection.Id).ToArray();
        IReadOnlyDictionary<string, StoredCredential> saved = wanted.Length == 0 || credentials is null
            ? new Dictionary<string, StoredCredential>()
            : await credentials.GetAsync(wanted, cancellation);
        return (unconfigured, wanted.Where(id => !saved.ContainsKey(id)).ToArray(), saved);
    }

    internal static IResult Failure(int status, string code, string detail, string[]? connections = null) =>
        Results.Problem(detail, statusCode: status, extensions: new Dictionary<string, object?>
        {
            ["code"] = code,
            ["connections"] = connections ?? [],
        });

    /// <summary>Reads the template for a run, or null when the report changed since it was listed.</summary>
    private byte[]? CurrentTemplate(CrystalEntry entry)
    {
        if (WorkerRevision(configuration["Crystal:WorkerPath"]) != entry.WorkerRevision) return null;
        if (!SafePath(entry.Root, entry.Path)) return null;
        var bytes = ReadTemplate(entry.Path);
        return Convert.ToHexString(SHA256.HashData(bytes)) == entry.TemplateHash ? bytes : null;
    }

    /// <summary>
    /// Tests an administrator's login for one data source of a template, without reading report
    /// data. Returns null when the database accepts it, otherwise the failure to show.
    /// </summary>
    public async Task<IResult?> VerifyAsync(byte[] template, CrystalBinding connection, StoredCredential credential,
        string subject, CancellationToken cancellation)
    {
        if (connection.Authentication != "saved")
            return Failure(400, "connection-not-saved", "This database signs in through the server's own settings.");
        if (string.IsNullOrWhiteSpace(credential.Login) || credential.Login.Length > 128
            || string.IsNullOrEmpty(credential.Password) || credential.Password.Length > 128)
            return Failure(400, "credentials-invalid", "Enter a valid database login and password.", [connection.Id]);
        if (IsAdministratorLogin(credential.Login))
            return Failure(400, "credentials-invalid",
                "The SQL Server administrator login (sa) cannot be used. Use a dedicated read-only login.", [connection.Id]);
        if (throttle.Blocked(subject))
            return Failure(429, "credentials-throttled",
                "Too many database sign-ins were rejected. Wait a few minutes and try again.", [connection.Id]);
        if (!await renders.WaitAsync(0, cancellation)) return Results.StatusCode(429);
        try
        {
            var profile = new WorkerProfile(connection.Source.Source, connection.Source.Database,
                connection.Source.Provider, false, credential.Login.Trim(), null, credential.Password);
            await InvokeAsync("connect", template, null, [profile], cancellation);
            throttle.Reset(subject);
            return null;
        }
        catch (CrystalWorkerException error) when (error.ExitCode == 7)
        {
            throttle.Record(subject);
            return Failure(422, "credentials-rejected",
                "The database did not accept the login. Check the login and password.", [connection.Id]);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            return Failure(504, "datasource-unavailable", "The database took too long to respond.", [connection.Id]);
        }
        catch (Exception error) when (!cancellation.IsCancellationRequested)
        {
            logger.LogWarning("Crystal connection check failed for connection {ConnectionId} ({Reason}).",
                connection.Id, FailureReason(error));
            return Failure(502, "datasource-unavailable",
                "The database could not be reached. Check that its ODBC data source exists on the server.", [connection.Id]);
        }
        finally { renders.Release(); }
    }

    public async Task<IResult> RenderAsync(CrystalEntry entry, CrystalRequest request, string subject,
        CancellationToken cancellation)
    {
        if (request.Version != entry.Version) return Results.Conflict();
        if (request.InteractionId == Guid.Empty) return Results.BadRequest();
        if (request.Output is not ("pdf" or "xlsx"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["format"] = ["Choose pdf or xlsx."] });
        var errors = ValidateValues(entry.Prompts, request.Values);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var (unconfigured, missing, saved) = await ReadinessAsync(entry.Connections, cancellation);
        if (unconfigured.Length > 0 || missing.Length > 0)
            return Failure(503, "datasource-needs-setup",
                "This report's database connection has not been set up.", [.. unconfigured, .. missing]);
        if (!await renders.WaitAsync(0, cancellation)) return Results.StatusCode(429);
        try
        {
            if (CurrentTemplate(entry) is not { } bytes) return Results.Conflict();
            var output = await InvokeAsync("render", bytes, request.Values,
                WorkerProfiles(entry.Connections, saved), cancellation, request.Output, RenderTimeout(configuration));
            if (request.Output == "pdf")
            {
                if (!output.AsSpan().StartsWith("%PDF-"u8)) throw new InvalidDataException("Invalid Crystal PDF.");
                return Results.File(output, "application/pdf");
            }
            // A worker built before Excel export ignores the format and still returns a PDF.
            if (output.AsSpan().StartsWith("%PDF-"u8)) throw new InvalidDataException(OutdatedWorker);
            if (output.AsSpan().StartsWith(new byte[] { 0x50, 0x4B, 0x03, 0x04 }))
                return Results.File(output, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            if (output.AsSpan().StartsWith(new byte[] { 0xD0, 0xCF, 0x11, 0xE0 }))
                return Results.File(output, "application/vnd.ms-excel");
            throw new InvalidDataException("Invalid Crystal Excel export.");
        }
        catch (CrystalWorkerException error) when (error.ExitCode is 4 or 6 or 7)
        {
            // The worker reports why a connection failed as an exit code only, so nothing about
            // the server, login or password can travel back in a message.
            logger.LogWarning("Crystal data source failed for {ReportId} ({Reason}), interaction {InteractionId}.",
                entry.Id, error.ExitCode switch
                {
                    4 => "connection not approved",
                    6 => "saved credential missing",
                    _ => "saved login rejected by the database",
                }, request.InteractionId);
            return error.ExitCode == 7
                ? Failure(502, "datasource-signin-failed", "The report's saved database login was not accepted.")
                : Failure(503, "datasource-needs-setup", "This report's database connection has not been set up.");
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            return Results.StatusCode(504);
        }
        catch (IOException error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            return Results.Conflict();
        }
        catch (Exception error) when (!cancellation.IsCancellationRequested)
        {
            logger.LogWarning("Crystal render failed for {ReportId} ({Reason}), interaction {InteractionId}.",
                entry.Id, FailureReason(error), request.InteractionId);
            return Results.Problem("The report could not be generated.", statusCode: 502);
        }
        finally { renders.Release(); }
    }

    private static string FailureReason(Exception error) =>
        error is CrystalWorkerException worker
            ? $"worker exit code {worker.ExitCode}; diagnostic lines {worker.DiagnosticLines}; HRESULT {worker.ErrorCode ?? "unavailable"}"
            : error is InvalidDataException { Message: OutdatedWorker } ? "rebuild and redeploy the Crystal worker"
            : error.GetType().Name;

    internal static Dictionary<string, string[]> ValidateValues(CrystalPrompt[] prompts, Dictionary<string, JsonElement>? values)
    {
        var errors = new Dictionary<string, string[]>();
        if (values is null)
        {
            errors["values"] = ["Supply a parameter object."];
            return errors;
        }
        if (values.Keys.Any(key => !prompts.Any(prompt => prompt.Name == key)))
            errors["values"] = ["Remove unknown parameters."];
        foreach (var prompt in prompts)
        {
            if (!values.TryGetValue(prompt.Name, out var value))
            {
                if (!prompt.Optional) errors[prompt.Name] = ["A value is required."];
                continue;
            }
            var valid = prompt.Multiple
                ? value.ValueKind == JsonValueKind.Array && value.GetArrayLength() is > 0 and <= 100
                    && value.EnumerateArray().All(item => ValidItem(prompt, item))
                : ValidItem(prompt, value);
            if (!valid) errors[prompt.Name] = [prompt.Range
                ? "Enter both endpoints in ascending order using valid values."
                : "Enter a valid value."];
        }
        return errors;
    }

    private static bool ValidItem(CrystalPrompt prompt, JsonElement value)
    {
        if (!prompt.Range) return ValidScalar(prompt, value);
        return value.ValueKind == JsonValueKind.Object && value.EnumerateObject().Count() == 2
            && value.TryGetProperty("start", out var start) && value.TryGetProperty("end", out var end)
            && ValidScalar(prompt, start) && ValidScalar(prompt, end)
            && Ordered(prompt.Kind, start.GetString()!, end.GetString()!);
    }

    private static bool Ordered(string kind, string start, string end)
    {
        var culture = System.Globalization.CultureInfo.InvariantCulture;
        return kind switch
        {
            "Number" => double.Parse(start, System.Globalization.NumberStyles.Float, culture)
                <= double.Parse(end, System.Globalization.NumberStyles.Float, culture),
            "Currency" => decimal.Parse(start, System.Globalization.NumberStyles.Float, culture)
                <= decimal.Parse(end, System.Globalization.NumberStyles.Float, culture),
            "Date" or "DateTime" => DateTime.Parse(start, culture) <= DateTime.Parse(end, culture),
            "Time" => TimeOnly.Parse(start, culture) <= TimeOnly.Parse(end, culture),
            "Boolean" => bool.Parse(start).CompareTo(bool.Parse(end)) <= 0,
            _ => string.CompareOrdinal(start, end) <= 0,
        };
    }

    private static bool ValidScalar(CrystalPrompt prompt, JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: > 0 and <= 2048 } input)
            return false;
        // A parameter's list of values is offered as suggestions: people may also type a value of the
        // right type (for example a plant or code that is not in the report's list yet).
        var culture = System.Globalization.CultureInfo.InvariantCulture;
        return prompt.Kind switch
        {
            "String" => true,
            "Number" => double.TryParse(input, System.Globalization.NumberStyles.Float, culture, out var number)
                && double.IsFinite(number),
            "Currency" => decimal.TryParse(input, System.Globalization.NumberStyles.Float, culture, out _),
            "Boolean" => bool.TryParse(input, out _),
            "Date" => DateOnly.TryParseExact(input, "yyyy-MM-dd", culture, System.Globalization.DateTimeStyles.None, out _),
            "DateTime" => DateTime.TryParseExact(input, ["yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss"],
                culture, System.Globalization.DateTimeStyles.None, out _),
            "Time" => TimeOnly.TryParseExact(input, ["HH:mm", "HH:mm:ss"],
                culture, System.Globalization.DateTimeStyles.None, out _),
            _ => false,
        };
    }

    private static bool Within(string root, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        return !Path.IsPathRooted(relative) && relative != ".." && !relative.StartsWith(".." + Path.DirectorySeparatorChar);
    }

    private static bool SafePath(string root, string path)
    {
        if (!Within(root, path)) return false;
        for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return false;
        return true;
    }

    private static byte[] ReadTemplate(string path)
    {
        using var input = File.OpenRead(path);
        if (input.Length is < 1 or > 16 * 1024 * 1024)
            throw new InvalidDataException("Invalid template size.");
        var bytes = new byte[(int)input.Length];
        input.ReadExactly(bytes);
        return bytes;
    }

    private static readonly TimeSpan DefaultWorkerTimeout = TimeSpan.FromSeconds(60);

    /// <summary>
    /// How long one report run may take: Crystal:RenderTimeoutSeconds (30 to 1800), 300 by default. A run
    /// must fetch every record and run every subreport before it can return, so it can take far longer than
    /// the first page takes to appear in Crystal Reports. Inspection and sign-in checks keep 60 seconds.
    /// </summary>
    internal static TimeSpan RenderTimeout(IConfiguration configuration) =>
        TimeSpan.FromSeconds(Math.Clamp(configuration.GetValue("Crystal:RenderTimeoutSeconds", 300), 30, 1800));

    private sealed record WorkerProfile(string Source, string Database, string Provider, bool IntegratedSecurity,
        string? User, string? PasswordEnvironmentVariable, string? Password);

    private static WorkerProfile[] WorkerProfiles(CrystalBinding[] connections,
        IReadOnlyDictionary<string, StoredCredential> saved) =>
        connections.Where(connection => connection.Authentication is "integrated" or "stored" or "saved").Select(connection =>
        {
            var source = connection.Source;
            return connection.Authentication switch
            {
                "integrated" => new WorkerProfile(source.Source, source.Database, source.Provider, true, null, null, null),
                // A saved password is decrypted only here and reaches the worker on standard input.
                "saved" => new WorkerProfile(source.Source, source.Database, source.Provider, false,
                    saved[connection.Id].Login.Trim(), null, saved[connection.Id].Password),
                _ => new WorkerProfile(source.Source, source.Database, source.Provider, false,
                    connection.Profile!.User!.Trim(), connection.Profile.PasswordEnvironmentVariable, null),
            };
        }).ToArray();

    private async Task<byte[]> InvokeAsync(string operation, byte[] template,
        Dictionary<string, JsonElement>? values, WorkerProfile[] profiles, CancellationToken cancellation,
        string? format = null, TimeSpan? limit = null)
    {
        var executable = configuration["Crystal:WorkerPath"];
        if (string.IsNullOrEmpty(executable) || !Path.IsPathFullyQualified(executable))
            throw new InvalidOperationException("Crystal worker path is unconfigured.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(limit ?? DefaultWorkerTimeout);
        var token = timeout.Token;
        var directory = Directory.CreateTempSubdirectory("1reports-crystal-");
        try
        {
            var file = Path.Combine(directory.FullName, "report.rpt");
            await File.WriteAllBytesAsync(file, template, token);
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo(executable)
                {
                    WorkingDirectory = directory.FullName,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };
            // The worker inherits only the stored passwords of the connections this run uses.
            var needed = profiles.Select(profile => profile.PasswordEnvironmentVariable).OfType<string>()
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var secrets = (configuration.GetSection("Crystal:Connections").Get<CrystalConnection[]>() ?? [])
                .Select(profile => profile.PasswordEnvironmentVariable).OfType<string>()
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var workerEnvironment = process.StartInfo.Environment;
            foreach (var name in workerEnvironment.Keys.Where(name =>
                !needed.Contains(name) &&
                (secrets.Contains(name) ||
                 name.StartsWith("ConnectionStrings__", StringComparison.OrdinalIgnoreCase) ||
                 name.StartsWith("HUB_", StringComparison.OrdinalIgnoreCase))).ToArray())
                workerEnvironment.Remove(name);
            process.Start();
            try
            {
                var diagnostics = ReadDiagnosticsAsync(process.StandardError, token);
                var input = JsonSerializer.Serialize(new
                {
                    operation,
                    path = file,
                    values,
                    profiles,
                    format,
                }, Json);
                if (Encoding.UTF8.GetByteCount(input) > 256 * 1024)
                    throw new InvalidDataException("Crystal worker request exceeds its limit.");
                await process.StandardInput.WriteAsync(input.AsMemory(), token);
                process.StandardInput.Close();
                using var output = new MemoryStream();
                var buffer = new byte[65536];
                int count;
                while ((count = await process.StandardOutput.BaseStream.ReadAsync(buffer, token)) != 0)
                {
                    if (output.Length + count > 32 * 1024 * 1024)
                        throw new InvalidDataException("Crystal output exceeds its limit.");
                    output.Write(buffer, 0, count);
                }
                await process.WaitForExitAsync(token);
                var (lines, errorCode) = await diagnostics;
                if (process.ExitCode != 0)
                    throw new CrystalWorkerException(process.ExitCode, lines, errorCode);
                return output.ToArray();
            }
            finally
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync();
                }
            }
        }
        finally
        {
            try { directory.Delete(recursive: true); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning("Could not clean up Crystal worker temporary files ({Reason}).", error.GetType().Name);
            }
        }
    }

    private static async Task<(int Lines, string? ErrorCode)> ReadDiagnosticsAsync(StreamReader reader, CancellationToken token)
    {
        var buffer = new char[1024];
        var captured = new StringBuilder();
        int count, lines = 0;
        while ((count = await reader.ReadAsync(buffer, token)) != 0)
        {
            foreach (var character in buffer.AsSpan(0, count))
                if (character == '\n') lines++;
            if (captured.Length < 4096)
                captured.Append(buffer, 0, Math.Min(count, 4096 - captured.Length));
        }
        var match = System.Text.RegularExpressions.Regex.Match(captured.ToString(), @"\(0x([0-9A-F]{8})\)");
        return (lines, match.Success ? match.Groups[1].Value : null);
    }

    private sealed class CrystalWorkerException(int exitCode, int diagnosticLines, string? errorCode) : Exception
    {
        internal int ExitCode { get; } = exitCode;
        internal int DiagnosticLines { get; } = diagnosticLines;
        internal string? ErrorCode { get; } = errorCode;
    }
}

internal sealed record CrystalConnection(string Source, string Database, string Provider,
    bool IntegratedSecurity = false, string? User = null, string? PasswordEnvironmentVariable = null,
    string? Authentication = null, string? Name = null);

/// <summary>Limits how often one person can have database sign-ins rejected, to slow password guessing.</summary>
internal sealed class CredentialThrottle(Func<DateTimeOffset> clock)
{
    internal const int Limit = 5;
    internal static readonly TimeSpan Window = TimeSpan.FromMinutes(5);
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, (int Count, DateTimeOffset Start)> failures = new();

    internal bool Blocked(string subject) =>
        failures.TryGetValue(subject, out var entry) && clock() - entry.Start < Window && entry.Count >= Limit;

    internal void Record(string subject)
    {
        var now = clock();
        failures.AddOrUpdate(subject, (1, now),
            (_, entry) => now - entry.Start < Window ? (entry.Count + 1, entry.Start) : (1, now));
        foreach (var stale in failures.Where(item => now - item.Value.Start >= Window).ToArray())
            failures.TryRemove(stale);
    }

    internal void Reset(string subject) => failures.TryRemove(subject, out _);
}

internal static class CrystalEndpoints
{
    internal const int MaxRenderRequestBytes = 128 * 1024;
    internal static void MapCrystalReports(this WebApplication app)
    {
        var reports = app.MapGroup("/api/reports")
            .RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireClaim(ClaimTypes.NameIdentifier));
        reports.MapGet("/status", (ICrystalReportCatalog catalog) => catalog.OperatorStatus())
            .RequireAuthorization(policy => policy.RequireRole("Administrator"));
        reports.MapGet("", async (ICrystalReportCatalog catalog, HttpContext context, HubIdentityDb db) =>
            !catalog.Ready ? Unavailable() : Results.Ok((await ReportAccess.VisibleAsync(context, catalog, db, context.RequestAborted))
                .Select(entry => new { entry.Id, entry.Name, entry.Category, entry.UpdatedAt })));
        reports.MapGet("/{id}", async (string id, ICrystalReportCatalog catalog, HttpContext context, HubIdentityDb db) =>
        {
            if (!catalog.Ready) return Unavailable();
            var entry = await ReportAccess.FindAsync(id, context, catalog, db, context.RequestAborted);
            if (entry is null) return Results.NotFound();
            // Nobody but an administrator ever enters a database login. When a connection still
            // needs one, people see that the report is not ready; administrators may set it up.
            var pending = (await catalog.NeedsSetupAsync(entry.Connections, context.RequestAborted)).ToHashSet();
            var administrator = context.User.IsInRole("Administrator");
            return Results.Ok(new
            {
                entry.Id, entry.Name, entry.Version,
                prompts = pending.Count > 0 ? Array.Empty<CrystalPrompt>() : entry.Prompts,
                setupRequired = pending.Count > 0,
                canConfigure = administrator,
                // Connection details are for administrators only; others learn just that setup is pending.
                connections = administrator
                    ? entry.Connections.Select(connection => new
                    {
                        connection.Id, connection.Label,
                        status = connection.Authentication == "unconfigured" ? "unconfigured"
                            : pending.Contains(connection.Id) ? "needs-login" : "ready",
                    }).ToArray()
                    : [],
            });
        });
        reports.MapPost("/{id}/view", async (string id, ViewRequest request, ICrystalReportCatalog catalog,
            HttpContext context, IAntiforgery antiforgery, HubIdentityDb db) =>
        {
            if (!await antiforgery.IsRequestValidAsync(context) || request.InteractionId == Guid.Empty)
                return Results.BadRequest();
            if (!catalog.Ready) return Unavailable();
            if (await ReportAccess.FindAsync(id, context, catalog, db, context.RequestAborted) is null) return Results.NotFound();
            await WorkspaceEndpoints.RecordAsync(db, context, id, request.InteractionId, "viewed");
            return Results.NoContent();
        });
        reports.MapPost("/{id}/render", async (string id, CrystalRequest request, ICrystalReportCatalog catalog,
            HttpContext context, IAntiforgery antiforgery, HubIdentityDb db) =>
        {
            if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
            if (!catalog.Ready) return Unavailable();
            var entry = await ReportAccess.FindAsync(id, context, catalog, db, context.RequestAborted);
            if (entry is null) return Results.NotFound();
            var result = await catalog.RenderAsync(entry, request,
                context.User.FindFirstValue(ClaimTypes.NameIdentifier)!, context.RequestAborted);
            // An Excel download re-exports a run the person already made, so only the report run itself is recorded.
            if (request.Output == "pdf" &&
                (result is IFileHttpResult || (result as IStatusCodeHttpResult)?.StatusCode is 502 or 504))
                await WorkspaceEndpoints.RecordAsync(db, context, id, request.InteractionId ?? Guid.NewGuid(),
                    result is IFileHttpResult ? "run-completed" : "run-failed");
            return result;
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxRenderRequestBytes));
    }

    private static IResult Unavailable() => Results.Problem("The report catalog is unavailable.", statusCode: 503);
    private sealed record ViewRequest(Guid InteractionId);
}
