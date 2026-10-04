using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace PersianSTT.Launcher;

internal static class AppFiles
{
    public static string Root { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PersianSTT");

    public static string ComposeFile => Path.Combine(Root, "compose.yml");
    public static string EnvFile => Path.Combine(Root, ".env");
    public static string EnvExampleFile => Path.Combine(Root, ".env.example");

    public static void EnsureInstalledFiles()
    {
        Directory.CreateDirectory(Root);

        // compose.yml belongs to the launcher release and may safely be refreshed.
        WriteEmbedded("PersianSTT.Launcher.Resources.compose.yml", ComposeFile, overwrite: true);
        WriteEmbedded("PersianSTT.Launcher.Resources.env.example", EnvExampleFile, overwrite: true);

        if (!File.Exists(EnvFile))
        {
            var template = File.ReadAllText(EnvExampleFile, Encoding.UTF8);
            template = template.Replace("__GENERATE_ON_FIRST_RUN__", NewSecret());
            File.WriteAllText(EnvFile, template, new UTF8Encoding(false));
        }
    }

    public static string GetEnv(string key, string fallback = "")
    {
        if (!File.Exists(EnvFile)) return fallback;
        foreach (var raw in File.ReadLines(EnvFile))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var pos = line.IndexOf('=');
            if (pos <= 0) continue;
            if (!string.Equals(line[..pos].Trim(), key, StringComparison.OrdinalIgnoreCase)) continue;
            return line[(pos + 1)..].Trim();
        }
        return fallback;
    }

    public static void SetEnv(string key, string value)
    {
        var lines = File.Exists(EnvFile)
            ? File.ReadAllLines(EnvFile).ToList()
            : new List<string>();

        var found = false;
        for (var i = 0; i < lines.Count; i++)
        {
            var trimmed = lines[i].Trim();
            if (trimmed.StartsWith('#')) continue;
            var pos = trimmed.IndexOf('=');
            if (pos <= 0) continue;
            if (!string.Equals(trimmed[..pos].Trim(), key, StringComparison.OrdinalIgnoreCase)) continue;
            lines[i] = $"{key}={value}";
            found = true;
            break;
        }
        if (!found) lines.Add($"{key}={value}");
        File.WriteAllLines(EnvFile, lines, new UTF8Encoding(false));
    }

    private static void WriteEmbedded(string resourceName, string destination, bool overwrite)
    {
        if (!overwrite && File.Exists(destination)) return;
        var assembly = Assembly.GetExecutingAssembly();
        using var source = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Missing embedded resource: {resourceName}");
        using var target = File.Create(destination);
        source.CopyTo(target);
    }

    private static string NewSecret()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}
