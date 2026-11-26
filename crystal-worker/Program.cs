using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

// Operations: "inspect" (prompts and data sources), "connect" (test the given data sources' logins),
// "render" (PDF, or with format "xlsx" a data-only Excel workbook), "explain" (every parameter of the
// main report and its subreports, and why it is or isn't prompted: for checking a report on the server).
// Exit codes read by the Hub: 0 success, 2 invalid request, 3 unsupported report,
// 4 unapproved connection, 5 report failure, 6 missing credential, 7 database sign-in refused.
internal static class Program
{
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 256 * 1024 };

    private static int Main()
    {
        try
        {
            var buffer = new char[256 * 1024 + 1];
            int length = Console.In.ReadBlock(buffer, 0, buffer.Length);
            if (length == buffer.Length) return 2;
            var request = Json.Deserialize<Request>(new string(buffer, 0, length));
            using (var report = new ReportDocument())
            {
                report.Load(request.path);
                var plan = Plan(report);
                var prompts = plan.Where(entry => entry.role == "prompt").Select(entry => entry.prompt).ToArray();
                if (request.operation == "explain")
                {
                    Console.Write(Json.Serialize(plan.Select(item => new
                    {
                        report = item.subreport.Length == 0 ? "(main report)" : item.subreport,
                        parameter = item.name,
                        item.role,
                        item.reason,
                        prompt = item.promptName,
                        usage = string.Join(", ", item.usage),
                    })));
                    return 0;
                }
                if (request.operation == "inspect")
                {
                    // Inspection reads only what is stored in the template, so a report's
                    // parameters and data sources are known before any database sign-in.
                    Console.Write(Json.Serialize(new { prompts, dataSources = DataSources(report) }));
                    return 0;
                }
                var profiles = request.profiles ?? new Profile[0];
                if (request.operation == "connect")
                {
                    // Tests only the data sources given (an administrator saving one login), without
                    // reading report data. A refused login exits with code 7.
                    int tested = TestConnections(report, profiles);
                    foreach (ReportDocument subreport in report.Subreports)
                        tested += TestConnections(subreport, profiles);
                    if (tested == 0) return 2;
                    Console.Write("{}");
                    return 0;
                }
                if (request.operation != "render") return 2;

                ConfigureConnections(report, profiles);
                foreach (ReportDocument subreport in report.Subreports)
                    ConfigureConnections(subreport, profiles);

                report.Refresh();
                var supplied = request.values ?? new Dictionary<string, object>();
                var byPrompt = prompts.ToDictionary(prompt => prompt.name);
                foreach (var item in plan)
                {
                    // Linked subreport parameters take their value from the main report while it
                    // runs, exactly as in Crystal Reports: nothing is set for them here.
                    if (item.role == "linked") continue;
                    // Looked up again: connecting and refreshing the report may replace the plan's objects.
                    var field = item.subreport.Length == 0
                        ? report.DataDefinition.ParameterFields[item.name]
                        : report.DataDefinition.ParameterFields[item.name, item.subreport];
                    if (item.role == "unused")
                    {
                        // Not used anywhere, so Crystal Reports doesn't ask for it. It is given an
                        // empty value only so that no "missing value" check can stop the export.
                        try { field.ApplyCurrentValues(Empty()); } catch (Exception) { }
                        continue;
                    }
                    // A prompt's own value, or (for a subreport parameter that shares a prompt with the
                    // main report or with other subreports) the value entered once for all of them.
                    var prompt = byPrompt[item.promptName];
                    field.ApplyCurrentValues(Values(prompt, supplied));
                }
                using (var output = report.ExportToStream(ExportType(request.format)))
                    output.CopyTo(Console.OpenStandardOutput());
                return 0;
            }
        }
        catch (NotSupportedException) { return 3; }
        catch (UnauthorizedAccessException) { return 4; }
        catch (MissingCredentialException) { return 6; }
        catch (Exception error)
        {
            // Only exception types, HRESULTs and worker line numbers are written. Messages can
            // carry server names, logins or connection strings, so they never leave this process.
            for (var cause = error; cause != null; cause = cause.InnerException)
                Console.Error.WriteLine($"Crystal worker: {cause.GetType().FullName} (0x{cause.HResult:X8})");
            var trace = new System.Diagnostics.StackTrace(error, true);
            foreach (var frame in trace.GetFrames() ?? Array.Empty<System.Diagnostics.StackFrame>())
            {
                var method = frame.GetMethod();
                if (method?.DeclaringType == typeof(Program))
                    Console.Error.WriteLine($"  at {method.Name}:{frame.GetFileLineNumber()}");
            }
            return IsLogOnFailure(error) ? 7 : 5;
        }
    }

    /// <summary>
    /// The export a run produces. Excel is the data-only workbook (.xlsx) where the installed runtime
    /// has it, else the legacy data-only sheet (.xls). Looked up by name so the worker builds against
    /// any Crystal runtime version.
    /// </summary>
    private static ExportFormatType ExportType(string format)
    {
        if (string.IsNullOrEmpty(format) || format == "pdf") return ExportFormatType.PortableDocFormat;
        if (format != "xlsx") throw new ArgumentException("Unsupported export format.");
        foreach (var name in new[] { "ExcelWorkbook", "ExcelRecord" })
            if (Enum.IsDefined(typeof(ExportFormatType), name))
                return (ExportFormatType)Enum.Parse(typeof(ExportFormatType), name);
        throw new NotSupportedException("Excel export is unavailable.");
    }

    private sealed class MissingCredentialException : Exception { }
    private sealed class SignInRefusedException : Exception { }

    private static bool IsLogOnFailure(Exception error)
    {
        for (var cause = error; cause != null; cause = cause.InnerException)
        {
            if (cause is LogOnException || cause is SignInRefusedException) return true;
            if (cause is EngineException engine && engine.ErrorID == EngineExceptionErrorID.LogOnFailed) return true;
            if (cause is System.Runtime.InteropServices.COMException &&
                (cause.Message ?? "").IndexOf("logon failed", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        }
        return false;
    }

    private static DataSource[] DataSources(ReportDocument report)
    {
        var result = new List<DataSource>();
        Collect(report, result);
        foreach (ReportDocument subreport in report.Subreports) Collect(subreport, result);
        return result.ToArray();
    }

    private static void Collect(ReportDocument report, List<DataSource> result)
    {
        foreach (Table table in report.Database.Tables)
        {
            var info = table.LogOnInfo.ConnectionInfo;
            string provider = Provider(info);
            if (result.Any(item => Same(item.source, info.ServerName ?? "")
                && Same(item.database, info.DatabaseName ?? "") && Same(item.provider, provider ?? ""))) continue;
            result.Add(new DataSource
            {
                source = info.ServerName ?? "",
                database = info.DatabaseName ?? "",
                provider = provider ?? "",
            });
        }
    }

    private static string Provider(ConnectionInfo info)
    {
        var attributes = info.Attributes.Collection;
        string provider = ConnectionAttribute(attributes, "QE_DatabaseType");
        return string.IsNullOrWhiteSpace(provider) ? ConnectionAttribute(attributes, "QE_Servertype") : provider;
    }

    private static void ConfigureConnections(ReportDocument report, Profile[] profiles)
    {
        foreach (Table table in report.Database.Tables)
        {
            var logon = table.LogOnInfo;
            var info = logon.ConnectionInfo;
            string provider = Provider(info);
            var matches = profiles.Where(profile =>
                Same(profile.source, info.ServerName) && Same(profile.database, info.DatabaseName)
                && Same(profile.provider, provider)).ToArray();
            if (matches.Length != 1 || string.IsNullOrWhiteSpace(provider))
            {
                if (Environment.GetEnvironmentVariable("EFI_CRYSTAL_DIAGNOSTICS") == "1")
                    Console.Error.WriteLine(Json.Serialize(new { source = info.ServerName, database = info.DatabaseName, provider }));
                throw new UnauthorizedAccessException("Unmapped Crystal connection.");
            }
            Apply(table, matches[0]);
        }
    }

    /// <summary>Signs in only the tables whose data source matches a given profile; returns how many.</summary>
    private static int TestConnections(ReportDocument report, Profile[] profiles)
    {
        int tested = 0;
        foreach (Table table in report.Database.Tables)
        {
            var info = table.LogOnInfo.ConnectionInfo;
            string provider = Provider(info);
            var matches = profiles.Where(profile =>
                Same(profile.source, info.ServerName) && Same(profile.database, info.DatabaseName)
                && Same(profile.provider, provider)).ToArray();
            if (matches.Length != 1 || string.IsNullOrWhiteSpace(provider)) continue;
            Apply(table, matches[0]);
            if (!table.TestConnectivity()) throw new SignInRefusedException();
            tested++;
        }
        return tested;
    }

    private static void Apply(Table table, Profile profile)
    {
        var logon = table.LogOnInfo;
        var info = logon.ConnectionInfo;
        if (!profile.integratedSecurity && Same(profile.user?.Trim(), "sa"))
            throw new UnauthorizedAccessException("An approved report login is required.");
        info.IntegratedSecurity = profile.integratedSecurity;
        info.UserID = profile.integratedSecurity ? "" : profile.user;
        // A saved login's password arrives on standard input. A service account's password
        // stays in the protected environment variable named by its profile.
        info.Password = profile.integratedSecurity ? ""
            : !string.IsNullOrEmpty(profile.password) ? profile.password
            : string.IsNullOrEmpty(profile.passwordEnvironmentVariable) ? null
            : Environment.GetEnvironmentVariable(profile.passwordEnvironmentVariable);
        if (!profile.integratedSecurity && (string.IsNullOrWhiteSpace(info.UserID) || string.IsNullOrEmpty(info.Password)))
            throw new MissingCredentialException();
        logon.ConnectionInfo = info;
        table.ApplyLogOnInfo(logon);
    }

    private static string ConnectionAttribute(NameValuePairs2 attributes, string name) =>
        attributes.ContainsKey(name)
            ? Convert.ToString(attributes.LookupNameValuePair(name).Value, Culture)
            : null;

    private static bool Same(string left, string right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    private static ParameterValues Empty() => new ParameterValues { new ParameterDiscreteValue { Value = null } };

    private static ParameterValues Values(Prompt prompt, Dictionary<string, object> supplied)
    {
        var values = new ParameterValues();
        if (!supplied.TryGetValue(prompt.name, out var value)) return Empty();
        if (prompt.multiple)
        {
            foreach (var item in (IEnumerable)value)
                values.Add(ConvertValue(prompt, item));
        }
        else
        {
            values.Add(ConvertValue(prompt, value));
        }
        return values;
    }

    private static readonly string[] Kinds = { "String", "Number", "Currency", "Boolean", "Date", "DateTime", "Time" };

    /// <summary>
    /// Decides, for every parameter of the main report and its subreports, what Crystal Reports itself
    /// would do with it, so people are asked only for what the report really needs:
    /// - "linked": a subreport parameter fed by a subreport link (from a main-report field, formula or
    ///   parameter). Crystal fills it while the report runs; it is never prompted.
    /// - "unused": a parameter the report doesn't use anywhere. Crystal doesn't prompt for these.
    /// - "shared": an unlinked subreport parameter with the same name and type as a main-report
    ///   parameter (or as one in another subreport). It is asked once and the value is passed down.
    /// - "prompt": everything else, asked once.
    /// Nothing here depends on a particular report: it reads the template's own links and usage.
    /// </summary>
    private static List<Planned> Plan(ReportDocument report)
    {
        // Subreport links, as Crystal stores them: which subreport parameters they feed, and which
        // main-report parameters they read. Read first: opening the report's definition to read them
        // re-synchronises the report, which invalidates parameter objects fetched before it.
        var linkedInto = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var linkSources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var subreportNames = new List<string>();
        foreach (ReportDocument subreport in report.Subreports) subreportNames.Add(subreport.Name);
        foreach (var subreportName in subreportNames)
        {
            var targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var link in SubreportLinks(report, subreportName))
            {
                if (!string.IsNullOrEmpty(link.Key)) targets.Add(ParameterName(link.Key));
                if (ParameterReference(link.Value) is string source) linkSources.Add(source);
            }
            linkedInto[subreportName] = targets;
        }

        // Then the parameters, keeping the plain values the plan needs.
        var all = new List<Planned>();
        foreach (ParameterFieldDefinition field in report.DataDefinition.ParameterFields)
        {
            all.Add(new Planned
            {
                field = field,
                name = field.ParameterFieldName,
                subreport = field.ReportName ?? "",
                linked = field.IsLinked(),
                usage = Usage(field),
                kind = field.ParameterValueKind.ToString().Replace("Parameter", ""),
                multiple = field.EnableAllowMultipleValue,
                range = field.DiscreteOrRangeKind != DiscreteOrRangeKind.DiscreteValue,
            });
        }

        foreach (var item in all)
        {
            string name = item.name;
            if (item.subreport.Length > 0 && (item.linked || item.usage.Contains("IsLinked")
                || (linkedInto.TryGetValue(item.subreport, out var targets) && targets.Contains(name))))
            {
                item.role = "linked";
                item.reason = "Filled from the main report by a subreport link.";
            }
        }

        var main = all.Where(entry => entry.subreport.Length == 0).ToList();
        var subreports = all.Where(entry => entry.subreport.Length > 0 && entry.role == null).ToList();

        // A subreport parameter its subreport doesn't use isn't prompted (nor does it keep a main prompt).
        foreach (var item in subreports.Where(Unused))
        {
            item.role = "unused";
            item.reason = "Not used in subreport " + item.subreport + ", so Crystal Reports doesn't prompt for it.";
        }
        subreports = subreports.Where(entry => entry.role == null).ToList();

        // An unlinked subreport parameter that matches a main-report parameter takes its value.
        foreach (var item in subreports)
        {
            var parent = main.FirstOrDefault(candidate => Matches(candidate, item));
            if (parent == null) continue;
            item.role = "shared";
            item.source = parent;
            item.reason = "Same name and type as the main report's parameter; its value is passed down.";
        }

        // Unused parameters aren't prompted, unless a subreport needs the value through a link or by sharing.
        foreach (var item in all.Where(entry => entry.role == null))
        {
            bool needed = item.subreport.Length == 0 && (linkSources.Contains(item.name)
                || all.Any(other => other.source == item));
            if (!needed && Unused(item))
            {
                item.role = "unused";
                item.reason = "Not used in the report, so Crystal Reports doesn't prompt for it.";
            }
        }

        // Equal unlinked parameters in several subreports (and none in the main report) are asked once.
        foreach (var item in subreports.Where(entry => entry.role == null))
        {
            var first = subreports.First(candidate => candidate.role == null && Matches(candidate, item));
            if (first == item) continue;
            item.role = "shared";
            item.source = first;
            item.reason = "Same name and type as a parameter of subreport " + first.subreport + "; asked once.";
        }

        // Everything left is a real prompt.
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in all.Where(entry => entry.role == null))
        {
            item.role = "prompt";
            item.reason = item.subreport.Length == 0 ? "Used by the report." : "Used by subreport " + item.subreport + ".";
            // A subreport prompt keeps its subreport in its name unless it stands for several subreports
            // (and no main-report parameter of another type already has that name).
            bool shared = item.subreport.Length > 0 && subreports.Any(other => other.source == item)
                && !main.Any(other => string.Equals(other.name, item.name, StringComparison.OrdinalIgnoreCase));
            string promptName = item.subreport.Length == 0 || shared
                ? item.name
                : item.subreport + "::" + item.name;
            if (!used.Add(promptName)) throw new NotSupportedException("Ambiguous parameter name.");
            item.prompt = Describe(report, item, promptName, shared);
            item.promptName = promptName;
        }
        foreach (var item in all.Where(entry => entry.role == "shared"))
        {
            var root = item.source;
            while (root.source != null) root = root.source;
            item.promptName = root.promptName;
        }
        return all;
    }

    private static bool Unused(Planned item) => item.usage.Contains("NotInUse") && !item.usage.Contains("InUse");

    private static bool Matches(Planned left, Planned right) =>
        string.Equals(left.name, right.name, StringComparison.OrdinalIgnoreCase)
        && left.kind == right.kind && left.multiple == right.multiple && left.range == right.range;

    private static Prompt Describe(ReportDocument report, Planned item, string name, bool shared)
    {
        var field = item.field;
        string subreport = item.subreport;
        string kind = item.kind;
        if (!Kinds.Contains(kind)) throw new NotSupportedException("Unsupported parameter type.");
        // The values of a dynamic (database-driven) list are not stored in the template,
        // so such a parameter is typed in instead of being picked from a list.
        bool dynamic = field.Attributes?["IsDCP"] is true;
        var choices = dynamic ? new string[0] : field.DefaultValues.Cast<ParameterValue>()
            .OfType<ParameterDiscreteValue>().Select(value => FormatValue(kind, value.Value)).ToArray();
        string label = string.IsNullOrEmpty(field.PromptText) ? item.name : field.PromptText;
        var definition = subreport.Length == 0
            ? report.ParameterFields[item.name]
            : report.ParameterFields.Find(item.name, subreport);
        return new Prompt
        {
            name = name,
            field = item.name,
            subreport = subreport,
            // A prompt that serves several subreports reads like a main-report prompt.
            label = subreport.Length == 0 || shared ? label : label + " (" + subreport + ")",
            kind = kind,
            optional = definition != null && definition.IsOptionalPrompt,
            multiple = item.multiple,
            // A parameter that accepts both discrete and range values is prompted as a
            // range; a single value is entered with the same start and end.
            range = item.range,
            dynamic = dynamic,
            choices = choices,
        };
    }

    /// <summary>
    /// The parameter's usage flags as Crystal reports them (InUse, NotInUse, IsLinked, ...). Read by name,
    /// so the worker builds against any Crystal runtime; empty when the runtime doesn't say.
    /// </summary>
    private static HashSet<string> Usage(ParameterFieldDefinition field)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var value = Member(field, "ParameterFieldUsage2");
            if (value != null)
                foreach (var flag in value.ToString().Split(','))
                    if (flag.Trim().Length > 0) result.Add(flag.Trim());
        }
        catch (Exception) { }
        return result;
    }

    /// <summary>
    /// A subreport's links from the report's own definition (Report Application Server): pairs of the
    /// subreport parameter each link feeds and the main-report field it reads. Empty if unavailable.
    /// </summary>
    private static List<KeyValuePair<string, string>> SubreportLinks(ReportDocument report, string subreport)
    {
        var result = new List<KeyValuePair<string, string>>();
        try
        {
            var client = Member(report, "ReportClientDocument");
            var controller = client == null ? null : Member(client, "SubreportController");
            if (controller == null) return result;
            var links = controller.GetType().InvokeMember("GetSubreportLinks",
                BindingFlags.InvokeMethod | BindingFlags.Public | BindingFlags.Instance, null,
                controller, new object[] { subreport }, Culture) as IEnumerable;
            if (links == null) return result;
            foreach (var link in links)
                result.Add(new KeyValuePair<string, string>(
                    Convert.ToString(Member(link, "LinkedParameterName"), Culture),
                    Convert.ToString(Member(link, "MainReportFieldName"), Culture)));
        }
        catch (Exception) { }
        return result;
    }

    /// <summary>A property read by name; works for managed objects and for the runtime's COM objects alike.</summary>
    private static object Member(object target, string name) =>
        target.GetType().InvokeMember(name, BindingFlags.GetProperty | BindingFlags.Public | BindingFlags.Instance,
            null, target, null, Culture);

    /// <summary>"{?Plant}" or "?Plant" or "Plant" → "Plant".</summary>
    private static string ParameterName(string value) => value.Trim().TrimStart('{').TrimEnd('}').TrimStart('?').Trim();

    /// <summary>The parameter a link reads, when it reads one ("{?Plant}"), else null.</summary>
    private static string ParameterReference(string field)
    {
        if (string.IsNullOrEmpty(field)) return null;
        var trimmed = field.Trim().TrimStart('{').TrimEnd('}');
        return trimmed.StartsWith("?") ? trimmed.Substring(1).Trim() : null;
    }

    private static string FormatValue(string kind, object value)
    {
        if (value is DateTime date)
            return date.ToString(kind == "Date" ? "yyyy-MM-dd" : kind == "Time" ? "HH:mm:ss" : "yyyy-MM-ddTHH:mm:ss", Culture);
        if (value is bool flag) return flag ? "true" : "false";
        return Convert.ToString(value, Culture);
    }

    private static ParameterValue ConvertValue(Prompt prompt, object supplied)
    {
        if (!prompt.range) return new ParameterDiscreteValue { Value = Parse(prompt.kind, (string)supplied) };
        var range = (Dictionary<string, object>)supplied;
        return new ParameterRangeValue
        {
            StartValue = Parse(prompt.kind, (string)range["start"]),
            EndValue = Parse(prompt.kind, (string)range["end"]),
            LowerBoundType = RangeBoundType.BoundInclusive,
            UpperBoundType = RangeBoundType.BoundInclusive,
        };
    }

    private static object Parse(string kind, string value)
    {
        switch (kind)
        {
            case "Number": return double.Parse(value, NumberStyles.Float, Culture);
            case "Currency": return decimal.Parse(value, NumberStyles.Float, Culture);
            case "Boolean": return bool.Parse(value);
            case "Date": return DateTime.ParseExact(value, "yyyy-MM-dd", Culture);
            case "DateTime": return DateTime.ParseExact(value,
                new[] { "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss" }, Culture, DateTimeStyles.None);
            case "Time": return DateTime.ParseExact(value,
                new[] { "HH:mm", "HH:mm:ss" }, Culture, DateTimeStyles.NoCurrentDateDefault);
            default: return value;
        }
    }

    public sealed class Request
    {
        public string operation { get; set; }
        public string path { get; set; }
        public Profile[] profiles { get; set; }
        public Dictionary<string, object> values { get; set; }
        public string format { get; set; }
    }

    public sealed class Profile
    {
        public string source { get; set; }
        public string database { get; set; }
        public string provider { get; set; }
        public bool integratedSecurity { get; set; }
        public string user { get; set; }
        public string passwordEnvironmentVariable { get; set; }
        public string password { get; set; }
    }

    private sealed class DataSource
    {
        public string source { get; set; }
        public string database { get; set; }
        public string provider { get; set; }
    }

    /// <summary>One parameter of the main report or a subreport, and what is done with it.</summary>
    private sealed class Planned
    {
        public ParameterFieldDefinition field;
        public string name;
        public string subreport;
        public bool linked;
        public bool multiple;
        public bool range;
        public string kind;
        public HashSet<string> usage;
        public string role;
        public string reason;
        public Planned source;
        public string promptName;
        public Prompt prompt;
    }

    private sealed class Prompt
    {
        public string name { get; set; }
        public string field { get; set; }
        public string subreport { get; set; }
        public string label { get; set; }
        public string kind { get; set; }
        public bool optional { get; set; }
        public bool multiple { get; set; }
        public bool range { get; set; }
        public bool dynamic { get; set; }
        public string[] choices { get; set; }
    }
}
