using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;

/// <summary>
/// Administrator-only setup: saving the database login each report data source uses, and
/// uploading new report templates. Regular users never reach these endpoints, and no endpoint
/// ever returns a saved password.
/// </summary>
internal static class ReportAdminEndpoints
{
    internal const int MaxTemplateBytes = 16 * 1024 * 1024;
    private static readonly byte[] CompoundFileSignature = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static void MapReportAdministration(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin")
            .RequireAuthorization(policy => policy.RequireRole("Administrator").RequireClaim(ClaimTypes.NameIdentifier));
        admin.MapGet("/report-databases", ListDatabasesAsync);
        admin.MapPut("/report-databases/{id}", SaveLoginAsync).RequireRateLimiting("sql-check");
        admin.MapDelete("/report-databases/{id}", RemoveLoginAsync);
        admin.MapGet("/report-folders", (ICrystalReportCatalog catalog) => Results.Ok(catalog.Roots()
            .Where(root => root.Uploadable).Select(root => new { root.Key, root.Category })));
        admin.MapPost("/report-uploads", UploadAsync)
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxTemplateBytes + 64 * 1024));
        admin.MapPost("/report-uploads/{token}/publish", PublishAsync);
        admin.MapDelete("/report-uploads/{token}", DiscardAsync);
    }

    private static IResult Problem(int status, string code, string detail) =>
        Results.Problem(detail, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });

    /// <summary>Every database the published reports use, whether it can sign in, and which reports use it.</summary>
    private static async Task<IResult> ListDatabasesAsync(ICrystalReportCatalog catalog, IReportCredentialStore store,
        CancellationToken cancellation)
    {
        var saved = (await store.ListAsync(cancellation)).ToDictionary(item => item.ConnectionId);
        var used = catalog.Entries.SelectMany(entry => entry.Connections.Select(connection => (connection, entry.Name)))
            .GroupBy(item => item.connection.Id)
            .Select(group =>
            {
                var connection = group.First().connection;
                saved.TryGetValue(connection.Id, out var login);
                return new DatabaseView(connection.Id, connection.Label, connection.Source.Source,
                    connection.Source.Database, connection.Source.Provider,
                    Status(connection, login is not null), login?.Login, login?.UpdatedAt,
                    group.Select(item => item.Name).Distinct().OrderBy(name => name).ToArray());
            }).ToList();
        // Logins saved for databases that no published report uses any more can still be removed.
        used.AddRange(saved.Values.Where(item => used.All(view => view.Id != item.ConnectionId))
            .Select(item => new DatabaseView(item.ConnectionId, item.Database, item.Source, item.Database,
                item.Provider, "saved", item.Login, item.UpdatedAt, [])));
        return Results.Ok(used.OrderBy(view => view.Label, StringComparer.OrdinalIgnoreCase));
    }

    private static string Status(CrystalBinding connection, bool hasLogin) => connection.Authentication switch
    {
        "integrated" or "stored" => "server",
        "saved" => hasLogin ? "saved" : "needs-login",
        _ => "unconfigured",
    };

    private sealed record DatabaseView(string Id, string Label, string Source, string Database, string Provider,
        string Status, string? Login, DateTimeOffset? UpdatedAt, string[] Reports);

    private sealed record LoginRequest(string? Login, string? Password, string? Upload);

    /// <summary>Tests a database login against a report that uses that database, then saves it encrypted.</summary>
    private static async Task<IResult> SaveLoginAsync(string id, LoginRequest request, HttpContext context,
        IAntiforgery antiforgery, ICrystalReportCatalog catalog, IReportCredentialStore store, IConfiguration configuration,
        CancellationToken cancellation)
    {
        if (!context.Request.IsHttps) return Problem(400, "https-required", "Open 1Reports over HTTPS to save database logins.");
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var login = request.Login?.Trim() ?? "";
        var password = request.Password ?? "";

        // The login is tested against a template that uses this database: a staged upload when
        // one is named, otherwise any published report.
        CrystalBinding? connection = null;
        byte[]? template = null;
        if (!string.IsNullOrEmpty(request.Upload))
        {
            if (await Staged(configuration, request.Upload, cancellation) is not { } upload) return Results.NotFound();
            connection = catalog.Bind(upload.Meta.DataSources).FirstOrDefault(item => item.Id == id);
            template = connection is null ? null : await File.ReadAllBytesAsync(upload.File, cancellation);
        }
        else
        {
            foreach (var entry in catalog.Entries)
            {
                connection = entry.Connections.FirstOrDefault(item => item.Id == id);
                if (connection is null) continue;
                template = await File.ReadAllBytesAsync(entry.Path, cancellation);
                break;
            }
        }
        if (connection is null || template is null) return Results.NotFound();

        var subject = context.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var credential = new StoredCredential(login, password);
        if (await catalog.VerifyAsync(template, connection, credential, subject, cancellation) is { } failure)
            return failure;
        await store.SaveAsync(connection, login, password, subject, cancellation);
        return Results.Ok(new { connection.Id, connection.Label, status = "saved", login });
    }

    private static async Task<IResult> RemoveLoginAsync(string id, HttpContext context, IAntiforgery antiforgery,
        IReportCredentialStore store, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        return await store.DeleteAsync(id, cancellation) ? Results.NoContent() : Results.NotFound();
    }

    private sealed record UploadMeta(string FileName, string Folder, CrystalDataSource[] DataSources, int Prompts,
        string UploadedBy, DateTimeOffset UploadedAt);

    internal static string UploadDirectory(IConfiguration configuration) =>
        configuration["Crystal:UploadPath"] is { Length: > 0 } path ? Path.GetFullPath(path)
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EFIHub", "uploads");

    private static async Task<(string File, UploadMeta Meta)?> Staged(IConfiguration configuration, string token,
        CancellationToken cancellation)
    {
        if (!Guid.TryParseExact(token, "N", out _)) return null;
        var directory = UploadDirectory(configuration);
        var file = Path.Combine(directory, token + ".rpt");
        var meta = Path.Combine(directory, token + ".json");
        if (!File.Exists(file) || !File.Exists(meta)) return null;
        await using var stream = File.OpenRead(meta);
        return (file, (await JsonSerializer.DeserializeAsync<UploadMeta>(stream, Json, cancellation))!);
    }

    internal static bool ValidFileName(string? name) =>
        !string.IsNullOrWhiteSpace(name) && name.Length <= 120 && name == Path.GetFileName(name)
        && !name.StartsWith('.') && name.IndexOfAny(Path.GetInvalidFileNameChars()) < 0
        && Path.GetExtension(name).Equals(".rpt", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Stages an uploaded template outside the web root and reads which databases it uses, so the
    /// administrator can supply any missing login before the report is published.
    /// </summary>
    private static async Task<IResult> UploadAsync(HttpContext context, IAntiforgery antiforgery,
        ICrystalReportCatalog catalog, IConfiguration configuration, ILoggerFactory loggers, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (!context.Request.HasFormContentType) return Problem(400, "file-required", "Choose a .rpt report file.");
        var form = await context.Request.ReadFormAsync(cancellation);
        var file = form.Files.GetFile("file");
        var folder = form["folder"].ToString();
        if (file is null || !ValidFileName(file.FileName))
            return Problem(400, "file-invalid", "Choose a Crystal Reports file with a .rpt name.");
        if (file.Length is < 1 or > MaxTemplateBytes)
            return Problem(400, "file-too-large", "The report file must be smaller than 16 MB.");
        var root = catalog.Roots().FirstOrDefault(item => item.Uploadable && item.Key == folder);
        if (root is null) return Problem(400, "folder-invalid", "Choose a report folder that accepts uploads.");

        var bytes = new byte[file.Length];
        await using (var input = file.OpenReadStream()) await input.ReadExactlyAsync(bytes, cancellation);
        if (!bytes.AsSpan().StartsWith(CompoundFileSignature))
            return Problem(400, "file-invalid", "This file is not a Crystal Reports (.rpt) report.");

        CrystalInspection inspection;
        try { inspection = await catalog.InspectAsync(bytes, cancellation); }
        catch (Exception error) when (!cancellation.IsCancellationRequested)
        {
            loggers.CreateLogger("ReportUpload").LogWarning("Uploaded report could not be read ({ErrorType}).", error.GetType().Name);
            return Problem(422, "report-unreadable",
                "The report could not be read. It may use an unsupported parameter type or be damaged.");
        }

        var directory = Directory.CreateDirectory(UploadDirectory(configuration));
        foreach (var stale in directory.EnumerateFiles().Where(item => item.LastWriteTimeUtc < DateTime.UtcNow.AddDays(-1)))
            stale.Delete();
        var token = Guid.NewGuid().ToString("N");
        var meta = new UploadMeta(file.FileName, root.Key, inspection.DataSources, inspection.Prompts.Length,
            context.User.FindFirstValue(ClaimTypes.NameIdentifier)!, DateTimeOffset.UtcNow);
        await File.WriteAllBytesAsync(Path.Combine(directory.FullName, token + ".rpt"), bytes, cancellation);
        await File.WriteAllTextAsync(Path.Combine(directory.FullName, token + ".json"),
            JsonSerializer.Serialize(meta, Json), cancellation);
        return Results.Ok(await Describe(token, meta, root, catalog, cancellation));
    }

    private static async Task<object> Describe(string token, UploadMeta meta, CrystalRoot root,
        ICrystalReportCatalog catalog, CancellationToken cancellation)
    {
        var connections = catalog.Bind(meta.DataSources);
        var pending = (await catalog.NeedsSetupAsync(connections, cancellation)).ToHashSet();
        return new
        {
            token, meta.FileName, folder = root.Key, root.Category, prompts = meta.Prompts,
            exists = File.Exists(Path.Combine(root.Path, meta.FileName)),
            connections = connections.Select(connection => new
            {
                connection.Id, connection.Label, database = connection.Source.Database,
                status = Status(connection, !pending.Contains(connection.Id)),
            }),
        };
    }

    private sealed record PublishRequest(bool Replace);

    /// <summary>Publishes a staged upload once every database it uses can sign in.</summary>
    private static async Task<IResult> PublishAsync(string token, PublishRequest request, HttpContext context,
        IAntiforgery antiforgery, ICrystalReportCatalog catalog, IConfiguration configuration, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (await Staged(configuration, token, cancellation) is not { } upload) return Results.NotFound();
        var root = catalog.Roots().FirstOrDefault(item => item.Uploadable && item.Key == upload.Meta.Folder);
        if (root is null) return Problem(400, "folder-invalid", "The report folder no longer accepts uploads.");
        var connections = catalog.Bind(upload.Meta.DataSources);
        if ((await catalog.NeedsSetupAsync(connections, cancellation)).Length > 0)
            return Problem(409, "needs-login", "Save a login for every database this report uses before publishing it.");
        if (!ValidFileName(upload.Meta.FileName)) return Problem(400, "file-invalid", "The report file name is not valid.");

        var target = Path.Combine(root.Path, upload.Meta.FileName);
        if (Path.GetDirectoryName(Path.GetFullPath(target)) != root.Path.TrimEnd(Path.DirectorySeparatorChar))
            return Problem(400, "file-invalid", "The report file name is not valid.");
        if (File.Exists(target) && !request.Replace)
            return Problem(409, "report-exists", "A report with this file name already exists. Choose to replace it.");
        // Copy beside the target first so the catalog never reads a half-written template.
        var partial = target + ".uploading";
        File.Copy(upload.File, partial, overwrite: true);
        File.Move(partial, target, overwrite: true);
        File.Delete(upload.File);
        File.Delete(Path.ChangeExtension(upload.File, ".json"));
        catalog.Rescan();
        return Results.Ok(new { upload.Meta.FileName, folder = root.Key, root.Category });
    }

    private static async Task<IResult> DiscardAsync(string token, HttpContext context, IAntiforgery antiforgery,
        IConfiguration configuration, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        if (await Staged(configuration, token, cancellation) is not { } upload) return Results.NotFound();
        File.Delete(upload.File);
        File.Delete(Path.ChangeExtension(upload.File, ".json"));
        return Results.NoContent();
    }
}
