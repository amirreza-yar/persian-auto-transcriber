using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace PersianSTT.Launcher;

internal sealed record VirtualizationState(bool? FirmwareEnabled, bool? Slat, bool? VmMonitor);
internal sealed record NetworkState(bool GhcrReachable, bool DockerDownloadReachable)
{
    public bool Ready => GhcrReachable && DockerDownloadReachable;
}

internal static class SystemChecks
{
    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        AllowAutoRedirect = true,
        AutomaticDecompression = DecompressionMethods.All,
    })
    {
        Timeout = TimeSpan.FromSeconds(8),
    };

    static SystemChecks()
    {
        Http.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("PersianSTT-Launcher", "1.0"));
    }

    public static async Task<NetworkState> CheckNetworkAsync()
    {
        var ghcr = await IsReachableAsync("https://ghcr.io/v2/", acceptUnauthorized: true);
        var docker = await IsReachableAsync("https://desktop.docker.com/");
        return new NetworkState(ghcr, docker);
    }

    public static async Task<bool> IsAppHealthyAsync()
    {
        try
        {
            using var response = await Http.GetAsync("http://127.0.0.1:8000/api/health");
            return response.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    public static async Task<VirtualizationState> GetVirtualizationStateAsync()
    {
        const string script =
            "$p=Get-CimInstance Win32_Processor | Select-Object -First 1 " +
            "VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions,VMMonitorModeExtensions;" +
            "$p | ConvertTo-Json -Compress";

        var result = await CommandRunner.RunAsync(
            "powershell.exe",
            new[] { "-NoProfile", "-NonInteractive", "-Command", script });

        if (!result.Success || string.IsNullOrWhiteSpace(result.StdOut))
            return new VirtualizationState(null, null, null);

        try
        {
            using var json = JsonDocument.Parse(result.StdOut.Trim());
            var root = json.RootElement;
            return new VirtualizationState(
                ReadNullableBool(root, "VirtualizationFirmwareEnabled"),
                ReadNullableBool(root, "SecondLevelAddressTranslationExtensions"),
                ReadNullableBool(root, "VMMonitorModeExtensions"));
        }
        catch
        {
            return new VirtualizationState(null, null, null);
        }
    }

    public static async Task<bool> IsWslModernAsync()
    {
        var result = await CommandRunner.RunAsync("wsl.exe", new[] { "--version" });
        return result.Success && result.Combined.Contains("WSL", StringComparison.OrdinalIgnoreCase);
    }

    private static bool? ReadNullableBool(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static async Task<bool> IsReachableAsync(string url, bool acceptUnauthorized = false)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (acceptUnauthorized && response.StatusCode == HttpStatusCode.Unauthorized) return true;
            return (int)response.StatusCode < 500;
        }
        catch { return false; }
    }
}
