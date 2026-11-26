using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

/// <summary>A saved database sign-in, decrypted only on the server for a single report run.</summary>
internal sealed record StoredCredential(string Login, string Password)
{
    // A record prints its members by default; a credential must never reach a log that way.
    public override string ToString() => nameof(StoredCredential);
}

/// <summary>What an administrator may see about a saved sign-in: never the password.</summary>
internal sealed record SavedCredentialInfo(string ConnectionId, string Source, string Database, string Provider,
    string Login, DateTimeOffset UpdatedAt);

internal interface IReportCredentialStore
{
    Task<IReadOnlyDictionary<string, StoredCredential>> GetAsync(IEnumerable<string> connectionIds, CancellationToken cancellation);
    Task<IReadOnlyList<SavedCredentialInfo>> ListAsync(CancellationToken cancellation);
    Task SaveAsync(CrystalBinding connection, string login, string password, string updatedBy, CancellationToken cancellation);
    Task<bool> DeleteAsync(string connectionId, CancellationToken cancellation);
}

/// <summary>
/// Keeps one database sign-in per report data source in the Hub database. Passwords are encrypted
/// with ASP.NET Data Protection under a purpose bound to the connection id, so a stored value
/// cannot be moved to another connection, and the key ring itself is protected on the server.
/// </summary>
internal sealed class ReportCredentialStore(IServiceScopeFactory scopes, IDataProtectionProvider protection)
    : IReportCredentialStore
{
    private readonly IDataProtector protector = protection.CreateProtector("EFIHub.ReportCredentials.v1");

    public async Task<IReadOnlyDictionary<string, StoredCredential>> GetAsync(
        IEnumerable<string> connectionIds, CancellationToken cancellation)
    {
        var ids = connectionIds.Distinct().ToArray();
        if (ids.Length == 0) return new Dictionary<string, StoredCredential>();
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        var rows = await db.ReportCredentials.AsNoTracking().Where(row => ids.Contains(row.ConnectionId))
            .ToArrayAsync(cancellation);
        var result = new Dictionary<string, StoredCredential>();
        foreach (var row in rows)
        {
            try
            {
                result[row.ConnectionId] = new(row.Login,
                    protector.CreateProtector(row.ConnectionId).Unprotect(row.ProtectedPassword));
            }
            catch (System.Security.Cryptography.CryptographicException)
            {
                // The key that protected this password is gone (for example the key ring was reset).
                // The connection is treated as needing setup instead of failing every run.
            }
        }
        return result;
    }

    public async Task<IReadOnlyList<SavedCredentialInfo>> ListAsync(CancellationToken cancellation)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        return await db.ReportCredentials.AsNoTracking().OrderBy(row => row.Database)
            .Select(row => new SavedCredentialInfo(row.ConnectionId, row.Source, row.Database, row.Provider,
                row.Login, row.UpdatedAt))
            .ToListAsync(cancellation);
    }

    public async Task SaveAsync(CrystalBinding connection, string login, string password, string updatedBy,
        CancellationToken cancellation)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        var row = await db.ReportCredentials.FirstOrDefaultAsync(item => item.ConnectionId == connection.Id, cancellation);
        var encrypted = protector.CreateProtector(connection.Id).Protect(password);
        if (row is null)
        {
            db.ReportCredentials.Add(new HubReportCredential
            {
                ConnectionId = connection.Id,
                Source = connection.Source.Source,
                Database = connection.Source.Database,
                Provider = connection.Source.Provider,
                Login = login,
                ProtectedPassword = encrypted,
                UpdatedAt = DateTimeOffset.UtcNow,
                UpdatedBy = updatedBy,
            });
        }
        else
        {
            row.Login = login;
            row.ProtectedPassword = encrypted;
            row.UpdatedAt = DateTimeOffset.UtcNow;
            row.UpdatedBy = updatedBy;
        }
        await db.SaveChangesAsync(cancellation);
    }

    public async Task<bool> DeleteAsync(string connectionId, CancellationToken cancellation)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HubIdentityDb>();
        return await db.ReportCredentials.Where(row => row.ConnectionId == connectionId)
            .ExecuteDeleteAsync(cancellation) > 0;
    }
}
