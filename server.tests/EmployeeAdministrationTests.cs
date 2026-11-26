using Microsoft.Extensions.Configuration;
using Xunit;

public sealed class EmployeeAdministrationTests
{
    [Fact]
    public void GrantUsesTheRoleSpellingUsedByReportAuthorization()
    {
        Assert.Equal("InventoryReader", EmployeeAdministration.ResolveReportRole(
            Configuration("InventoryReader"), "inventoryreader"));
    }

    [Fact]
    public void GrantRejectsUnapprovedAndAmbiguousRoles()
    {
        var configuration = Configuration("InventoryReader", "inventoryreader", "Administrator");
        Assert.Throws<InvalidOperationException>(() => EmployeeAdministration.ResolveReportRole(configuration, "InventoryReader"));
        Assert.Throws<InvalidOperationException>(() => EmployeeAdministration.ResolveReportRole(configuration, "ShippingReader"));
        Assert.Throws<InvalidOperationException>(() => EmployeeAdministration.ResolveReportRole(configuration, "administrator"));
    }

    private static IConfiguration Configuration(params string[] roles) =>
        new ConfigurationBuilder().AddInMemoryCollection(roles.Select((role, index) =>
            new KeyValuePair<string, string?>($"Crystal:Roots:inventory:Roles:{index}", role))).Build();
}
