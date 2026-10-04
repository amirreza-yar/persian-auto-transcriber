using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace PersianSTT.Launcher;

internal sealed record VirtualizationState(
    bool HypervisorPresent,
    bool? FirmwareEnabled,
    bool? Slat,
    bool? VmMonitor);
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
            "$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1;" +
            "$cs=Get-CimInstance Win32_ComputerSystem;" +
            "[pscustomobject]@{" +
            "HypervisorPresent=[bool]$cs.HypervisorPresent;" +
            "VirtualizationFirmwareEnabled=$cpu.VirtualizationFirmwareEnabled;" +
            "SecondLevelAddressTranslationExtensions=$cpu.SecondLevelAddressTranslationExtensions;" +
            "VMMonitorModeExtensions=$cpu.VMMonitorModeExtensions" +
            "} | ConvertTo-Json -Compress";

        var result = await CommandRunner.RunAsync(
            "powershell.exe",
            new[] { "-NoProfile", "-NonInteractive", "-Command", script });

        if (!result.Success || string.IsNullOrWhiteSpace(result.StdOut))
            return new VirtualizationState(false, null, null, null);

        try
        {
            using var json = JsonDocument.Parse(result.StdOut.Trim());
            var root = json.RootElement;
            return new VirtualizationState(
                ReadBool(root, "HypervisorPresent"),
                ReadNullableBool(root, "VirtualizationFirmwareEnabled"),
                ReadNullableBool(root, "SecondLevelAddressTranslationExtensions"),
                ReadNullableBool(root, "VMMonitorModeExtensions"));
        }
        catch
        {
            return new VirtualizationState(false, null, null, null);
        }
    }

    public static async Task<bool> IsWslModernAsync()
    {
        // Do not inspect the text emitted by `wsl --version`. wsl.exe can emit
        // localized output and, when redirected, some Windows/WSL versions can
        // produce text that is captured with unexpected encoding/null bytes.
        // The old implementation therefore reported "WSL setup required" even
        // when a current WSL installation was present.
        //
        // A successful `wsl --version` is the capability check we need here.
        // Older inbox WSL builds that do not support --version will fail and are
        // correctly sent through Setup / Repair, where `wsl --update` is run.
        try
        {
            var wslPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "wsl.exe");

            if (!File.Exists(wslPath)) return false;

            var result = await CommandRunner.RunAsync(
                wslPath,
                new[] { "--version" });

            return result.Success;
        }
        catch
        {
            return false;
        }
    }

    private static bool ReadBool(JsonElement root, string name)
    {
        return root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
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
