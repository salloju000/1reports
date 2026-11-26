using System.Text.Json;
using Xunit;

public sealed class CrystalPromptTests
{
    [Theory]
    [InlineData("Number", "1e100", true)]
    [InlineData("Number", "1e999", false)]
    [InlineData("Number", "NaN", false)]
    [InlineData("Currency", "1e100", false)]
    [InlineData("Time", "09:30", true)]
    [InlineData("Time", "09:30:15", true)]
    [InlineData("Time", "09:30:15.2", false)]
    [InlineData("DateTime", "2026-11-14T09:30:15", true)]
    [InlineData("DateTime", "2026-11-14T09:30:15Z", false)]
    public void ScalarUsesTheWorkerTypeAndWireFormat(string kind, string input, bool valid)
    {
        CrystalPrompt[] prompts = [new("value", "Value", kind, false, false, false, [])];
        var values = new Dictionary<string, JsonElement> { ["value"] = JsonSerializer.SerializeToElement(input) };
        Assert.Equal(valid, CrystalCatalog.ValidateValues(prompts, values).Count == 0);
    }

    [Theory]
    [InlineData("""{"period":{"start":"2026-11-01","end":"2026-11-14"}}""", true)]
    [InlineData("""{"period":{"start":"2026-11-14","end":"2026-11-01"}}""", false)]
    [InlineData("""{"period":{"start":"2026-11-14","end":null}}""", false)]
    [InlineData("""{"period":{"start":"2026-11-01","end":"2026-11-31"}}""", false)]
    [InlineData("""{}""", true)]
    public void OptionalDateRangeMustBeCompleteAndOrdered(string json, bool valid)
    {
        CrystalPrompt[] prompts = [new("period", "Period", "Date", true, false, true, [])];
        var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
        var errors = CrystalCatalog.ValidateValues(prompts, values);
        Assert.Equal(valid, errors.Count == 0);
        if (!valid) Assert.Contains("period", errors.Keys);
    }

    [Theory]
    [InlineData("P02", true)]
    [InlineData("P07", true)]
    [InlineData("", false)]
    public void ListedValuesAreSuggestionsAndOtherValuesMayBeTyped(string input, bool valid)
    {
        CrystalPrompt[] prompts = [new("plant", "Plant", "String", false, false, false, ["P01", "P02", "P03"])];
        var values = new Dictionary<string, JsonElement> { ["plant"] = JsonSerializer.SerializeToElement(input) };
        Assert.Equal(valid, CrystalCatalog.ValidateValues(prompts, values).Count == 0);
    }

    [Fact]
    public void TypedValuesStillHaveToMatchTheParameterType()
    {
        CrystalPrompt[] prompts = [new("qty", "Quantity", "Number", false, false, false, ["10", "20"])];
        var values = new Dictionary<string, JsonElement> { ["qty"] = JsonSerializer.SerializeToElement("lots") };
        Assert.Contains("qty", CrystalCatalog.ValidateValues(prompts, values).Keys);
    }
}
