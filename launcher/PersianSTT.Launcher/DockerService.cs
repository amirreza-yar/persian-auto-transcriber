using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;

namespace PersianSTT.Launcher;

internal sealed class DockerService
{
    private readonly Action<string> _log;

    public DockerService(Action<string> log) => _log = log;

    public static string? DockerDesktopPath
    {
        get
        {
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "DockerDesktop", "Docker Desktop.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    "Docker", "Docker", "Docker Desktop.exe"),
            };
            return candidates.FirstOrDefault(File.Exists);
        }
    }

    public static string DockerCliPath
    {
        get
        {
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    "Docker", "Docker", "resources", "bin", "docker.exe"),
            };
            return candidates.FirstOrDefault(File.Exists) ?? "docker.exe";
        }
    }

    public async Task<bool> IsCliInstalledAsync()
    {
        try
        {
            var result = await CommandRunner.RunAsync(DockerCliPath, new[] { "--version" });
            return result.Success;
        }
        catch { return DockerDesktopPath is not null; }
    }

    public async Task<bool> IsEngineReadyAsync()
    {
        try
        {
            var result = await CommandRunner.RunAsync(DockerCliPath, new[] { "info", "--format", "{{.ServerVersion}}" });
            return result.Success;
        }
        catch { return false; }
    }

    public async Task<bool> StartDesktopAndWaitAsync(TimeSpan timeout)
    {
        if (await IsEngineReadyAsync()) return true;
        var desktop = DockerDesktopPath;
        if (desktop is null) return false;

        _log("Starting Docker Desktop…");
        Process.Start(new ProcessStartInfo(desktop) { UseShellExecute = true });

        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (await IsEngineReadyAsync()) return true;
            await Task.Delay(2000);
        }
        return false;
    }

    public async Task<CommandResult> ComposeAsync(params string[] args)
    {
        var all = new List<string>
        {
            "compose", "--env-file", AppFiles.EnvFile, "-f", AppFiles.ComposeFile,
        };
        all.AddRange(args);
        _log($"> docker {string.Join(' ', all.Select(QuoteForLog))}");
        var result = await CommandRunner.RunAsync(DockerCliPath, all, AppFiles.Root, _log);
        _log(result.Success ? $"✓ Exit code {result.ExitCode}" : $"✗ Exit code {result.ExitCode}");
        return result;
    }

    public async Task<bool> ImageExistsAsync()
    {
        var image = AppFiles.GetEnv("APP_IMAGE", "ghcr.io/amirreza-yar/persian-auto-transcriber:stable");
        var result = await CommandRunner.RunAsync(DockerCliPath, new[] { "image", "inspect", image });
        return result.Success;
    }

    public async Task<bool> InstallDockerDesktopAsync(IProgress<int>? progress = null)
    {
        if (System.Runtime.InteropServices.RuntimeInformation.OSArchitecture != System.Runtime.InteropServices.Architecture.X64)
            throw new PlatformNotSupportedException("This Persian STT release currently supports x64 Windows only.");

        const string installerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe";
        var tempDir = Path.Combine(Path.GetTempPath(), "PersianSTT");
        Directory.CreateDirectory(tempDir);
        var installer = Path.Combine(tempDir, "Docker Desktop Installer.exe");

        _log("Downloading Docker Desktop from Docker's official distribution server…");
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        using var response = await http.GetAsync(installerUrl, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();

        var total = response.Content.Headers.ContentLength;
        await using var input = await response.Content.ReadAsStreamAsync();
        await using var output = File.Create(installer);
        var buffer = new byte[1024 * 128];
        long readTotal = 0;
        int read;
        while ((read = await input.ReadAsync(buffer)) > 0)
        {
            await output.WriteAsync(buffer.AsMemory(0, read));
            readTotal += read;
            if (total is > 0) progress?.Report((int)(readTotal * 100L / total.Value));
        }

        _log("Installing Docker Desktop (per-user, WSL 2 backend)…");
        var psi = new ProcessStartInfo
        {
            FileName = installer,
            UseShellExecute = true,
        };
        psi.ArgumentList.Add("install");
        psi.ArgumentList.Add("--user");
        psi.ArgumentList.Add("--accept-license");
        psi.ArgumentList.Add("--backend=wsl-2");
        psi.ArgumentList.Add("--no-windows-containers");

        using var process = Process.Start(psi)
            ?? throw new InvalidOperationException("Could not launch Docker Desktop installer.");
        await process.WaitForExitAsync();
        _log($"Docker Desktop installer exit code: {process.ExitCode}");
        return process.ExitCode == 0;
    }

    public async Task<bool> RestoreMigrationAsync(string migrationFolder)
    {
        var dataArchive = Path.Combine(migrationFolder, "app-data.tar.gz");
        if (!File.Exists(dataArchive))
            throw new FileNotFoundException("Migration folder does not contain app-data.tar.gz.");

        var metadata = Path.Combine(migrationFolder, "migration.env");
        if (File.Exists(metadata))
        {
            var secret = ReadSimpleEnv(metadata, "APP_SECRET_KEY");
            if (!string.IsNullOrWhiteSpace(secret))
            {
                AppFiles.SetEnv("APP_SECRET_KEY", secret);
                _log("Preserved APP_SECRET_KEY from the source installation.");
            }
        }

        var image = AppFiles.GetEnv("APP_IMAGE", "ghcr.io/amirreza-yar/persian-auto-transcriber:stable");
        var dataVolume = AppFiles.GetEnv("DATA_VOLUME_NAME", "persian-stt-data");
        var modelVolume = AppFiles.GetEnv("MODEL_VOLUME_NAME", "persian-stt-models");

        var stop = await ComposeAsync("stop");
        if (!stop.Success) return false;

        await EnsureVolumeAsync(dataVolume);
        if (!await RestoreArchiveAsync(image, dataVolume, migrationFolder, "app-data.tar.gz"))
            return false;

        var modelArchive = Path.Combine(migrationFolder, "models.tar.gz");
        if (File.Exists(modelArchive))
        {
            await EnsureVolumeAsync(modelVolume);
            if (!await RestoreArchiveAsync(image, modelVolume, migrationFolder, "models.tar.gz"))
                return false;
        }

        // The customer build deliberately uses the host/system VPN rather than
        // the source machine's old SOCKS setting. Preserve all other runtime data.
        if (!await ClearMigratedProxySettingAsync(image, dataVolume))
            return false;

        _log("Migration import complete.");
        return true;
    }


    private async Task<bool> ClearMigratedProxySettingAsync(string image, string dataVolume)
    {
        const string code =
            "import sqlite3,os; p='/data/app.db'; " +
            "db=sqlite3.connect(p) if os.path.exists(p) else None; " +
            "db and db.execute(\"UPDATE app_settings SET value=? WHERE key=?\", ('\"\"','network.proxy_url')); " +
            "db and db.execute(\"UPDATE circuit_breakers SET state='closed', consecutive_failures=0, opened_until=NULL, last_error=NULL WHERE name='gemini'\"); " +
            "db and db.commit(); db and db.close()";

        _log("Clearing the old application SOCKS proxy setting for host-VPN networking…");
        var result = await CommandRunner.RunAsync(DockerCliPath, new[]
        {
            "run", "--rm",
            "-v", $"{dataVolume}:/data",
            image,
            "python", "-c", code,
        }, onOutput: _log);
        return result.Success;
    }

    private async Task EnsureVolumeAsync(string name)
    {
        var inspect = await CommandRunner.RunAsync(DockerCliPath, new[] { "volume", "inspect", name });
        if (inspect.Success) return;
        var create = await CommandRunner.RunAsync(DockerCliPath, new[] { "volume", "create", name }, onOutput: _log);
        if (!create.Success) throw new InvalidOperationException($"Could not create Docker volume {name}.");
    }

    private async Task<bool> RestoreArchiveAsync(string image, string volume, string hostFolder, string archive)
    {
        const string code =
            "import os,shutil,tarfile; root='/target'; " +
            "[(shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)) " +
            "for p in [os.path.join(root,n) for n in os.listdir(root)]]; " +
            "tarfile.open('/backup/ARCHIVE','r:gz').extractall(root,filter='data')";

        var pythonCode = code.Replace("ARCHIVE", archive, StringComparison.Ordinal);
        var args = new[]
        {
            "run", "--rm",
            "-v", $"{volume}:/target",
            "-v", $"{Path.GetFullPath(hostFolder)}:/backup:ro",
            image,
            "python", "-c", pythonCode,
        };

        _log($"Restoring {archive} into Docker volume {volume}…");
        var result = await CommandRunner.RunAsync(DockerCliPath, args, onOutput: _log);
        if (!result.Success) _log($"Restore failed with exit code {result.ExitCode}.");
        return result.Success;
    }

    private static string ReadSimpleEnv(string path, string key)
    {
        foreach (var raw in File.ReadLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var pos = line.IndexOf('=');
            if (pos > 0 && string.Equals(line[..pos].Trim(), key, StringComparison.OrdinalIgnoreCase))
                return line[(pos + 1)..].Trim();
        }
        return "";
    }

    private static string QuoteForLog(string value) => value.Contains(' ') ? $"\"{value}\"" : value;
}
