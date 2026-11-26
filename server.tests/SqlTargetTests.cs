using Microsoft.Extensions.Configuration;
using Xunit;

public sealed class SqlTargetTests
{
    private static IConfiguration Configuration(params (string Key, string Value)[] settings) =>
        new ConfigurationBuilder().AddInMemoryCollection(
            settings.ToDictionary(setting => "ReportSql:" + setting.Key, setting => (string?)setting.Value)).Build();

    [Fact]
    public void TheOriginalSingleTargetStillWorks()
    {
        var target = Assert.Single(SqlConnectionEndpoints.Targets(Configuration(
            ("Host", "sql.example.test"), ("Port", "1433"), ("Database", "Reports")))!);
        Assert.Equal(new SqlConnectionEndpoints.SqlTarget("sql.example.test", 1433, "Reports"), target);
    }

    [Fact]
    public void AdditionalReportDatabasesAreApprovedIndividually()
    {
        var targets = SqlConnectionEndpoints.Targets(Configuration(
            ("Host", "sql.example.test"), ("Port", "1433"), ("Database", "Reports"),
            ("Targets:0:Host", "finance.example.test"), ("Targets:0:Port", "1444"), ("Targets:0:Database", "Ledger")))!;
        Assert.Equal(["Reports", "Ledger"], targets.Select(target => target.Database));
        Assert.Equal(1444, targets[1].Port);
    }

    [Fact]
    public void MissingInvalidOrAmbiguousTargetsCloseTheCheck()
    {
        Assert.Null(SqlConnectionEndpoints.Targets(Configuration()));
        Assert.Null(SqlConnectionEndpoints.Targets(Configuration(("Host", "sql.example.test"), ("Database", "Reports"))));
        Assert.Null(SqlConnectionEndpoints.Targets(Configuration(
            ("Host", "sql.example.test"), ("Port", "1433"), ("Database", "Reports"),
            ("Targets:0:Host", "other.example.test"), ("Targets:0:Port", "1433"), ("Targets:0:Database", "reports"))));
        Assert.Null(SqlConnectionEndpoints.Targets(Configuration(
            ("Targets:0:Host", "bad host"), ("Targets:0:Port", "1433"), ("Targets:0:Database", "Ledger"))));
    }
}
