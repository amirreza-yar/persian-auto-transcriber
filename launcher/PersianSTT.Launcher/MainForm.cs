using System.Diagnostics;
using System.Drawing;

namespace PersianSTT.Launcher;

internal sealed class MainForm : Form
{
    private readonly Label _headline = new();
    private readonly Label _network = new();
    private readonly Label _virtualization = new();
    private readonly Label _docker = new();
    private readonly Label _app = new();
    private readonly Label _operation = new();
    private readonly ProgressBar _progress = new();
    private readonly TextBox _log = new();

    private readonly Button _setup = new() { Text = "Setup / Repair" };
    private readonly Button _start = new() { Text = "Start" };
    private readonly Button _open = new() { Text = "Open" };
    private readonly Button _update = new() { Text = "Update" };
    private readonly Button _stop = new() { Text = "Stop" };
    private readonly Button _import = new() { Text = "Import migration" };
    private readonly Button _details = new() { Text = "Show details" };

    private readonly DockerService _dockerService;
    private bool _busy;
    private bool _refreshing;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 5000 };

    public MainForm()
    {
        Text = "Persian STT";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(760, 520);
        Size = new Size(820, 570);
        Font = new Font("Segoe UI", 10F);
        BackColor = Color.White;

        AppFiles.EnsureInstalledFiles();
        _dockerService = new DockerService(Log);

        BuildUi();
        WireEvents();
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(22),
            ColumnCount = 1,
            RowCount = 7,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(root);

        var title = new Label
        {
            Text = "Persian Auto Transcriber",
            AutoSize = true,
            Font = new Font("Segoe UI", 18F, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 2),
        };
        root.Controls.Add(title);

        _headline.Text = "Checking this computer…";
        _headline.AutoSize = true;
        _headline.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
        _headline.ForeColor = Color.DimGray;
        _headline.Margin = new Padding(0, 0, 0, 14);
        root.Controls.Add(_headline);

        var statusPanel = new TableLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Top,
            ColumnCount = 2,
            Margin = new Padding(0, 0, 0, 16),
        };
        statusPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        statusPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddStatus(statusPanel, "VPN / network", _network);
        AddStatus(statusPanel, "Virtualization / WSL", _virtualization);
        AddStatus(statusPanel, "Docker Desktop", _docker);
        AddStatus(statusPanel, "Persian STT", _app);
        root.Controls.Add(statusPanel);

        var actions = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Top,
            WrapContents = true,
            Margin = new Padding(0, 0, 0, 12),
        };
        foreach (var button in new[] { _setup, _start, _open, _update, _stop, _import, _details })
        {
            button.AutoSize = true;
            button.MinimumSize = new Size(96, 36);
            button.Margin = new Padding(0, 0, 8, 8);
            actions.Controls.Add(button);
        }
        root.Controls.Add(actions);

        _operation.AutoSize = true;
        _operation.ForeColor = Color.DimGray;
        _operation.Text = "Ready.";
        _operation.Margin = new Padding(0, 0, 0, 5);
        root.Controls.Add(_operation);

        _progress.Dock = DockStyle.Top;
        _progress.Height = 8;
        _progress.Style = ProgressBarStyle.Marquee;
        _progress.MarqueeAnimationSpeed = 0;
        _progress.Margin = new Padding(0, 0, 0, 10);
        root.Controls.Add(_progress);

        _log.Multiline = true;
        _log.ReadOnly = true;
        _log.ScrollBars = ScrollBars.Vertical;
        _log.WordWrap = false;
        _log.Dock = DockStyle.Fill;
        _log.Font = new Font("Consolas", 9F);
        _log.Visible = false;
        root.Controls.Add(_log);
    }

    private void WireEvents()
    {
        Shown += async (_, _) =>
        {
            await RefreshStatusAsync();
            _timer.Start();
        };
        FormClosed += (_, _) => _timer.Stop();
        _timer.Tick += async (_, _) => await RefreshStatusAsync();

        _details.Click += (_, _) =>
        {
            _log.Visible = !_log.Visible;
            _details.Text = _log.Visible ? "Hide details" : "Show details";
        };

        _setup.Click += async (_, _) => await RunBusyAsync("Setting up this computer…", SetupAsync);
        _start.Click += async (_, _) => await RunBusyAsync("Starting Persian STT…", StartAppAsync);
        _update.Click += async (_, _) => await RunBusyAsync("Updating Persian STT…", UpdateAppAsync);
        _stop.Click += async (_, _) => await RunBusyAsync("Stopping Persian STT…", StopAppAsync);
        _open.Click += async (_, _) =>
        {
            if (!await SystemChecks.IsAppHealthyAsync())
            {
                MessageBox.Show(this, "Persian STT is not ready yet. Press Start first.", "Persian STT",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Process.Start(new ProcessStartInfo("http://127.0.0.1:8000") { UseShellExecute = true });
        };
        _import.Click += async (_, _) => await ImportMigrationAsync();
    }

    private async Task SetupAsync()
    {
        var network = await SystemChecks.CheckNetworkAsync();
        if (!network.Ready)
        {
            MessageBox.Show(this,
                "Docker/GHCR are not reachable from Windows. Connect your system/TUN VPN, then press Setup / Repair again.",
                "VPN required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        if (!await SystemChecks.IsWslModernAsync())
        {
            var answer = MessageBox.Show(this,
                "WSL 2 is missing or too old. Persian STT can enable/update the required Windows components. Windows may require a restart. Continue?",
                "Configure WSL 2", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;

            Log("Enabling WSL and Virtual Machine Platform (administrator approval required)…");
            var script =
                "dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart; " +
                "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; " +
                "dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart; " +
                "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; " +
                "bcdedit /set hypervisorlaunchtype auto; " +
                "try { wsl.exe --update } catch {};";
            var code = await CommandRunner.RunElevatedAsync("powershell.exe", "-NoProfile", "-Command", script);
            if (code != 0)
                throw new InvalidOperationException($"Windows prerequisite setup failed with exit code {code}.");

            if (!await SystemChecks.IsWslModernAsync())
            {
                MessageBox.Show(this,
                    "Windows virtualization components were enabled, but WSL is not ready yet. Restart Windows, then open Persian STT and press Setup / Repair again.",
                    "Restart required", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
        }

        if (!await _dockerService.IsCliInstalledAsync())
        {
            var answer = MessageBox.Show(this,
                "Docker Desktop is not installed. Continue to download Docker Desktop from Docker's official server and install it in per-user mode using the WSL 2 backend? Continuing also accepts Docker Desktop's license terms.",
                "Install Docker Desktop", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;

            var progress = new Progress<int>(p =>
            {
                _operation.Text = $"Downloading Docker Desktop… {p}%";
                _progress.Style = ProgressBarStyle.Continuous;
                _progress.Value = Math.Clamp(p, 0, 100);
            });
            if (!await _dockerService.InstallDockerDesktopAsync(progress))
                throw new InvalidOperationException("Docker Desktop installation did not complete successfully.");
        }

        _operation.Text = "Starting Docker Desktop…";
        _progress.Style = ProgressBarStyle.Marquee;
        _progress.MarqueeAnimationSpeed = 25;
        if (!await _dockerService.StartDesktopAndWaitAsync(TimeSpan.FromMinutes(2)))
        {
            var virt = await SystemChecks.GetVirtualizationStateAsync();
            var detail = virt.HypervisorPresent
                ? "Windows hypervisor is active, so this is not a BIOS virtualization problem. Restart Windows if WSL/Virtual Machine Platform was just enabled, then press Setup / Repair again."
                : virt.FirmwareEnabled == false
                    ? "Windows currently reports CPU virtualization as unavailable. VT-d is not the setting Docker needs; check Intel Virtualization Technology / VT-x or AMD SVM. If Docker has worked on this PC before, restart Windows first because WSL/Virtual Machine Platform changes may still be pending."
                    : "Docker Desktop is installed but its engine is not ready. Restart Windows if WSL/Virtual Machine Platform was just enabled, complete any Docker first-run prompt, then press Setup / Repair again.";

            MessageBox.Show(this,
                detail,
                "Docker not ready", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        _operation.Text = "Downloading Persian STT image…";
        var pull = await _dockerService.ComposeAsync("pull");
        if (!pull.Success)
            throw new InvalidOperationException("Could not download the Persian STT image. Check the VPN/network and Show details.");

        await StartAppAsync();
    }

    private async Task StartAppAsync()
    {
        if (!await _dockerService.IsEngineReadyAsync())
        {
            if (!await _dockerService.StartDesktopAndWaitAsync(TimeSpan.FromMinutes(2)))
                throw new InvalidOperationException("Docker Desktop is not ready. Use Setup / Repair first.");
        }

        if (!await _dockerService.ImageExistsAsync())
        {
            var network = await SystemChecks.CheckNetworkAsync();
            if (!network.Ready)
                throw new InvalidOperationException("The app image is not installed and GHCR is unreachable. Connect the system VPN first.");
            var pull = await _dockerService.ComposeAsync("pull");
            if (!pull.Success) throw new InvalidOperationException("Could not pull the application image.");
        }

        var up = await _dockerService.ComposeAsync("up", "-d", "--remove-orphans");
        if (!up.Success) throw new InvalidOperationException("Docker Compose could not start Persian STT.");

        _operation.Text = "Waiting for the API health check…";
        var ready = await WaitForHealthAsync(TimeSpan.FromSeconds(90));
        if (!ready)
            throw new InvalidOperationException("Containers started, but /api/health did not become ready. Open Show details for Docker output.");

        _operation.Text = "Persian STT is ready.";
    }

    private async Task UpdateAppAsync()
    {
        var network = await SystemChecks.CheckNetworkAsync();
        if (!network.GhcrReachable)
        {
            MessageBox.Show(this,
                "GHCR is not reachable. Connect your system/TUN VPN before updating.",
                "VPN required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        if (!await _dockerService.IsEngineReadyAsync() &&
            !await _dockerService.StartDesktopAndWaitAsync(TimeSpan.FromMinutes(2)))
            throw new InvalidOperationException("Docker Desktop is not ready.");

        var pull = await _dockerService.ComposeAsync("pull");
        if (!pull.Success)
            throw new InvalidOperationException("Update download failed. The current installation was not replaced.");

        var up = await _dockerService.ComposeAsync("up", "-d", "--remove-orphans");
        if (!up.Success)
            throw new InvalidOperationException("The image downloaded, but containers could not be recreated.");

        if (!await WaitForHealthAsync(TimeSpan.FromSeconds(90)))
            throw new InvalidOperationException("Update finished, but the API health check is not ready.");

        _operation.Text = "Update complete. Persian STT is ready.";
    }

    private async Task StopAppAsync()
    {
        if (!await _dockerService.IsEngineReadyAsync()) return;
        var result = await _dockerService.ComposeAsync("stop");
        if (!result.Success) throw new InvalidOperationException("Could not stop Persian STT cleanly.");
        _operation.Text = "Persian STT is stopped. Data is preserved.";
    }

    private async Task ImportMigrationAsync()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Select the migration folder containing app-data.tar.gz and migration.env",
            UseDescriptionForTitle = true,
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        await RunBusyAsync("Importing the old installation…", async () =>
        {
            if (!await _dockerService.IsEngineReadyAsync() &&
                !await _dockerService.StartDesktopAndWaitAsync(TimeSpan.FromMinutes(2)))
                throw new InvalidOperationException("Docker Desktop must be running before importing data.");

            if (!await _dockerService.ImageExistsAsync())
            {
                var network = await SystemChecks.CheckNetworkAsync();
                if (!network.GhcrReachable)
                    throw new InvalidOperationException("The application image is not installed. Connect the VPN first so it can be downloaded.");
                var pull = await _dockerService.ComposeAsync("pull");
                if (!pull.Success) throw new InvalidOperationException("Could not download the application image.");
            }

            if (!await _dockerService.RestoreMigrationAsync(dialog.SelectedPath))
                throw new InvalidOperationException("Migration import failed. Existing archive files were not deleted.");

            var answer = MessageBox.Show(this,
                "Migration imported successfully. Start Persian STT now?",
                "Migration complete", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer == DialogResult.Yes) await StartAppAsync();
        });
    }

    private async Task RunBusyAsync(string text, Func<Task> action)
    {
        if (_busy) return;
        _busy = true;
        SetButtonsEnabled(false);
        _operation.Text = text;
        _progress.Style = ProgressBarStyle.Marquee;
        _progress.MarqueeAnimationSpeed = 25;

        try
        {
            await action();
        }
        catch (Exception ex)
        {
            Log("ERROR: " + ex.Message);
            _operation.Text = ex.Message;
            MessageBox.Show(this, ex.Message, "Persian STT", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _progress.MarqueeAnimationSpeed = 0;
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = 0;
            _busy = false;
            SetButtonsEnabled(true);
            await RefreshStatusAsync();
        }
    }

    private async Task RefreshStatusAsync()
    {
        if (_busy || _refreshing) return;
        _refreshing = true;
        try
        {
            var networkTask = SystemChecks.CheckNetworkAsync();
            var virtTask = SystemChecks.GetVirtualizationStateAsync();
            var wslTask = SystemChecks.IsWslModernAsync();
            var cliTask = _dockerService.IsCliInstalledAsync();
            var appTask = SystemChecks.IsAppHealthyAsync();

            await Task.WhenAll(networkTask, virtTask, wslTask, cliTask, appTask);
            var network = await networkTask;
            var virt = await virtTask;
            var wsl = await wslTask;
            var cli = await cliTask;
            var engine = cli && await _dockerService.IsEngineReadyAsync();
            var healthy = await appTask;

            SetStatus(_network,
                network.Ready ? "Reachable" : "Connect system VPN for install/update/Gemini",
                network.Ready ? Color.DarkGreen : Color.DarkOrange);

            // Capability-first status: a running Docker engine is definitive proof that
            // the virtualization stack is usable. Do not mark the machine as broken just
            // because a CIM firmware flag is false/unknown while Hyper-V/WSL is active.
            var platformReady = engine || virt.HypervisorPresent || wsl;
            var virtText = engine
                ? "Ready"
                : wsl
                    ? "WSL ready — Docker not running"
                    : virt.HypervisorPresent
                        ? "Hypervisor ready — WSL setup required"
                        : "WSL setup required";
            SetStatus(_virtualization, virtText,
                platformReady ? (wsl || engine ? Color.DarkGreen : Color.DarkOrange) : Color.DarkOrange);

            SetStatus(_docker,
                !cli ? "Not installed" : engine ? "Running" : "Installed, not running",
                !cli ? Color.DarkOrange : engine ? Color.DarkGreen : Color.DarkOrange);

            SetStatus(_app,
                healthy ? "Running — http://127.0.0.1:8000" : engine ? "Stopped / starting" : "Not running",
                healthy ? Color.DarkGreen : Color.DimGray);

            _headline.Text = healthy
                ? "Ready to transcribe"
                : !cli
                    ? "Setup required"
                    : !engine
                        ? "Docker Desktop is not running"
                        : "Persian STT is not running";
            _headline.ForeColor = healthy ? Color.DarkGreen : Color.DimGray;
            _open.Enabled = healthy;
        }
        catch (Exception ex)
        {
            Log("Status refresh: " + ex.Message);
        }
        finally
        {
            _refreshing = false;
        }
    }

    private async Task<bool> WaitForHealthAsync(TimeSpan timeout)
    {
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (await SystemChecks.IsAppHealthyAsync()) return true;
            await Task.Delay(1500);
        }
        return false;
    }

    private void Log(string line)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => Log(line)));
            return;
        }
        _log.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}{Environment.NewLine}");
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    private void SetButtonsEnabled(bool enabled)
    {
        foreach (var button in new[] { _setup, _start, _update, _stop, _import }) button.Enabled = enabled;
        _details.Enabled = true;
    }

    private static void AddStatus(TableLayoutPanel panel, string title, Label value)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var name = new Label
        {
            Text = title,
            AutoSize = true,
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 4, 12, 4),
        };
        value.Text = "Checking…";
        value.AutoSize = true;
        value.Margin = new Padding(0, 4, 0, 4);
        panel.Controls.Add(name, 0, row);
        panel.Controls.Add(value, 1, row);
    }

    private static void SetStatus(Label label, string text, Color color)
    {
        label.Text = text;
        label.ForeColor = color;
    }
}
