using Microsoft.Extensions.Configuration;
using Xunit;

public sealed class CrystalPublishingTests
{
    [Fact]
    public void ReportIdSurvivesMoveWhenTheOriginalKeyIsRetained()
    {
        var original = new ConfigurationBuilder().Build();
        var moved = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Crystal:ReportIds:labels/ORIGINAL.RPT"] = "published/renamed.rpt",
        }).Build();

        Assert.Equal(CrystalCatalog.ReportId(original, "labels", "original.rpt"),
            CrystalCatalog.ReportId(moved, "published", "renamed.rpt"));
    }

    [Theory]
    [InlineData(0, true, 0, 1, false)]
    [InlineData(1, false, 0, 1, false)]
    [InlineData(1, true, 0, 0, true)]
    [InlineData(1, true, 0, 1, false)]
    [InlineData(1, true, 1, 1, true)]
    public void CatalogDistinguishesEmptyUnavailableAndDegradedScans(
        int scannedRoots, bool workerAvailable, int available, int rejected, bool ready)
    {
        Assert.Equal(ready, CrystalCatalog.IsScanReady(scannedRoots, workerAvailable, available, rejected));
    }

    [Fact]
    public void PinnedRootOnlySelectsTheApprovedFile()
    {
        var directory = Path.Combine(Path.GetTempPath(), "pilot");
        var approved = "SRPL-InvRefNEW-4x6.rpt";
        var files = CrystalCatalog.PublishingFiles(directory, approved, new string('A', 64));

        Assert.Equal(Path.Combine(directory, approved), Assert.Single(files));
    }

    [Theory]
    [InlineData(null, "bad")]
    [InlineData("report.rpt", null)]
    [InlineData("report.rpt", "bad")]
    [InlineData("../report.rpt", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("report.pdf", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    public void InvalidApprovalConfigurationFailsClosed(string? file, string? hash)
    {
        Assert.Throws<InvalidDataException>(() => CrystalCatalog.PublishingFiles(Path.GetTempPath(), file, hash));
    }

    [Fact]
    public void ReplacementBytesRequireUpdatedApproval()
    {
        var hash = new string('A', 64);
        Assert.True(CrystalCatalog.MatchesApproval(hash, hash.ToLowerInvariant()));
        Assert.False(CrystalCatalog.MatchesApproval(new string('B', 64), hash));
        Assert.True(CrystalCatalog.MatchesApproval(hash, null));
    }
}
