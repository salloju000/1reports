using Microsoft.Extensions.Configuration;
using Xunit;

public sealed class CrystalTimeoutTests
{
    private static IConfiguration Settings(string? seconds) => new ConfigurationBuilder()
        .AddInMemoryCollection(seconds is null ? [] : [new("Crystal:RenderTimeoutSeconds", seconds)])
        .Build();

    [Fact]
    public void ARunMayTakeFiveMinutesByDefault() =>
        Assert.Equal(TimeSpan.FromMinutes(5), CrystalCatalog.RenderTimeout(Settings(null)));

    [Theory]
    [InlineData("600", 600)]
    [InlineData("5", 30)]
    [InlineData("99999", 1800)]
    public void TheConfiguredLimitIsKeptWithinBounds(string configured, int expected) =>
        Assert.Equal(TimeSpan.FromSeconds(expected), CrystalCatalog.RenderTimeout(Settings(configured)));
}
