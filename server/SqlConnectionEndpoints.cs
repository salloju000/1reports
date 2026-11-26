using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Data.SqlClient;

internal static class SqlConnectionEndpoints
{
    internal static void MapSqlConnectionCheck(this WebApplication app)
    {
        app.MapPost("/api/sql/check", CheckAsync)
            .RequireAuthorization(policy => policy.RequireRole("Administrator"))
            .RequireRateLimiting("sql-check");
    }

    private static async Task<IResult> CheckAsync(
        SqlCheckRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        IConfiguration configuration)
    {
        if (!context.Request.IsHttps) return Results.BadRequest();
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();

        var targets = Targets(configuration);
        if (targets is null)
            return Failure(503, "The approved SQL Server connection is not configured.");

        var login = request.Login?.Trim();
        if (string.IsNullOrEmpty(login) || login.Length > 128 ||
            string.IsNullOrEmpty(request.Password) || request.Password.Length > 128)
            return Failure(400, "Enter a valid SQL login and password.");
        if (string.Equals(login, "sa", StringComparison.OrdinalIgnoreCase))
            return Failure(400, "Use a dedicated read-only SQL login.");
        var target = targets.FirstOrDefault(item =>
            string.Equals(request.Database?.Trim(), item.Database, StringComparison.Ordinal));
        if (target is null)
            return Failure(400, "Enter the database name approved by your administrator.");
        var (host, port, database) = target;

        var settings = new SqlConnectionStringBuilder
        {
            DataSource = $"tcp:{host},{port}",
            InitialCatalog = database,
            UserID = login,
            Password = request.Password,
            Encrypt = SqlConnectionEncryptOption.Mandatory,
            TrustServerCertificate = false,
            PersistSecurityInfo = false,
            Pooling = false,
            ConnectTimeout = 5,
            ConnectRetryCount = 0,
            ApplicationName = "1Reports",
        };

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            await using var connection = new SqlConnection(settings.ConnectionString);
            await connection.OpenAsync(deadline.Token);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT DB_NAME(),
                       CASE WHEN EXISTS (
                           SELECT 1 FROM sys.login_token
                           WHERE type = 'SERVER ROLE' AND name <> 'public'
                       ) OR EXISTS (
                           SELECT 1
                           FROM sys.user_token t
                           JOIN sys.database_principals p ON p.principal_id = t.principal_id
                           WHERE p.is_fixed_role = 1 AND p.name NOT IN ('db_datareader', 'db_denydatawriter', 'db_denydatareader')
                       ) OR USER_NAME() IN ('dbo', 'guest')
                       OR EXISTS (
                           SELECT 1 FROM sys.fn_my_permissions(NULL, 'SERVER')
                           WHERE permission_name NOT IN ('CONNECT SQL', 'VIEW ANY DATABASE')
                       ) OR EXISTS (
                           SELECT 1 FROM sys.fn_my_permissions(NULL, 'DATABASE')
                           WHERE permission_name NOT IN ('CONNECT', 'SELECT', 'VIEW DEFINITION',
                                'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION', 'VIEW ANY COLUMN MASTER KEY DEFINITION')
                       ) OR EXISTS (
                           SELECT 1 FROM sys.schemas s
                           CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name), 'SCHEMA') p
                           WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
                             AND p.permission_name NOT IN ('SELECT', 'VIEW DEFINITION')
                       ) OR EXISTS (
                           SELECT 1 FROM sys.objects o
                           CROSS APPLY sys.fn_my_permissions(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT') p
                           WHERE o.is_ms_shipped = 0
                             AND p.permission_name NOT IN ('SELECT', 'VIEW DEFINITION')
                       ) THEN 1 ELSE 0 END,
                       CASE WHEN EXISTS (
                           SELECT 1 FROM sys.objects o
                           CROSS APPLY sys.fn_my_permissions(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT') p
                           WHERE o.is_ms_shipped = 0 AND o.type IN ('U', 'V') AND p.permission_name = 'SELECT'
                       ) THEN 1 ELSE 0 END
                """;
            command.CommandTimeout = 3;
            await using var reader = await command.ExecuteReaderAsync(deadline.Token);
            if (!await reader.ReadAsync(deadline.Token))
                return Failure(502, "SQL Server did not return connection details.");
            if (reader.GetInt32(1) != 0)
                return Failure(403, "Use a dedicated SQL login with only approved read permissions.");
            if (reader.GetInt32(2) != 1)
                return Failure(403, "The SQL login has no read access to report tables or views.");

            return Results.Ok(new { host, port, database = reader.GetString(0), encryption = "Required" });
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
        {
            return Failure(504, "The SQL connection check timed out.");
        }
        catch (SqlException error)
        {
            return error.Number switch
            {
                -2 => Failure(504, "The SQL connection check timed out."),
                18452 or 18456 or 18487 or 18488 =>
                    Failure(422, "SQL Server rejected the login. Check the credentials and account status."),
                4060 or 916 => Failure(422, "The login cannot access the requested database."),
                _ => Failure(502, "SQL Server could not be reached securely. Check the SQL listener, network access, and TLS certificate."),
            };
        }
    }

    /// <summary>
    /// Reads every approved report database: the single <c>ReportSql</c> target and any listed under
    /// <c>ReportSql:Targets</c>. Returns null when none is configured or any entry is invalid or
    /// ambiguous, so a configuration mistake closes the check instead of widening it.
    /// </summary>
    internal static SqlTarget[]? Targets(IConfiguration configuration)
    {
        var root = configuration.GetSection("ReportSql");
        var sections = root.GetSection("Targets").GetChildren().ToList();
        if (root["Host"] is not null || root["Database"] is not null || root["Port"] is not null)
            sections.Insert(0, root);
        var targets = new List<SqlTarget>();
        foreach (var section in sections)
        {
            var database = section["Database"]?.Trim();
            if (Uri.CheckHostName(section["Host"]) != UriHostNameType.Dns ||
                string.IsNullOrWhiteSpace(database) ||
                !int.TryParse(section["Port"], out var port) || port is < 1 or > 65535 ||
                targets.Any(item => string.Equals(item.Database, database, StringComparison.OrdinalIgnoreCase)))
                return null;
            targets.Add(new(section["Host"]!, port, database));
        }
        return targets.Count == 0 ? null : targets.ToArray();
    }

    internal sealed record SqlTarget(string Host, int Port, string Database);

    private static IResult Failure(int status, string detail) =>
        Results.Problem(statusCode: status, detail: detail);

    private sealed record SqlCheckRequest(string? Database, string? Login, string? Password);
}
