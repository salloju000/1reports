using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>Swaps the Hub's SQL Server database for a private in-memory one, so endpoint tests need no server.</summary>
internal static class TestDatabase
{
    internal static void UseInMemoryHub(this IServiceCollection services, string? name = null)
    {
        var database = name ?? Guid.NewGuid().ToString();
        services.RemoveAll<DbContextOptions<HubIdentityDb>>();
        services.RemoveAll(typeof(IDbContextOptionsConfiguration<HubIdentityDb>));
        services.AddDbContext<HubIdentityDb>(options => options.UseInMemoryDatabase(database)
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
    }
}
