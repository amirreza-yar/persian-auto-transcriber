# Persian STT Windows launcher
# Requires Docker Desktop. No additional PowerShell modules are required.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $Root "compose.yml"
$EnvFile = Join-Path $Root ".env"
$EnvExample = Join-Path $Root ".env.example"
$AppUrl = "http://127.0.0.1:8000"
$HealthUrl = "$AppUrl/api/health"
$DockerDesktop = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes)).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Ensure-EnvironmentFile {
    if (Test-Path $EnvFile) { return }

    if (-not (Test-Path $EnvExample)) {
        throw "Missing .env.example next to the launcher."
    }

    $secret = New-RandomSecret
    $text = Get-Content -Raw -Path $EnvExample
    $text = $text.Replace("__GENERATE_ON_FIRST_RUN__", $secret)
    [System.IO.File]::WriteAllText($EnvFile, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-DockerCli {
    return $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
}

function Test-DockerEngine {
    try {
        & docker info --format '{{.ServerVersion}}' *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Start-DockerDesktopIfNeeded {
    if (-not (Test-DockerCli)) {
        $answer = [System.Windows.Forms.MessageBox]::Show(
            "Docker Desktop is required but was not found. Open the Docker Desktop download page?",
            "Docker Desktop required",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
        if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
            Start-Process "https://www.docker.com/products/docker-desktop/"
        }
        return $false
    }

    if (Test-DockerEngine) { return $true }

    if (Test-Path $DockerDesktop) {
        Start-Process $DockerDesktop | Out-Null
    }

    $script:StatusLabel.Text = "Starting Docker Desktop…"
    $script:Form.Refresh()

    for ($i = 0; $i -lt 60; $i++) {
        if (Test-DockerEngine) { return $true }
        Start-Sleep -Seconds 2
        [System.Windows.Forms.Application]::DoEvents()
    }

    [System.Windows.Forms.MessageBox]::Show(
        "Docker Desktop did not become ready. Start Docker Desktop manually, then try again.",
        "Docker is not ready",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return $false
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Ensure-EnvironmentFile
    if (-not (Start-DockerDesktopIfNeeded)) { return $false }

    Push-Location $Root
    try {
        $script:LogBox.AppendText("`r`n> docker compose $($Arguments -join ' ')`r`n")
        $script:Form.Refresh()

        $base = @("compose", "--env-file", $EnvFile, "-f", $ComposeFile)
        $output = & docker @base @Arguments 2>&1
        $exit = $LASTEXITCODE
        if ($output) {
            $script:LogBox.AppendText(($output | Out-String))
        }
        $script:LogBox.SelectionStart = $script:LogBox.TextLength
        $script:LogBox.ScrollToCaret()

        if ($exit -ne 0) {
            throw "Docker command failed with exit code $exit."
        }
        return $true
    } finally {
        Pop-Location
    }
}

function Test-AppHealth {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Refresh-Status {
    if (-not (Test-DockerCli)) {
        $script:StatusLabel.Text = "Docker Desktop is not installed"
        $script:StatusLabel.ForeColor = [System.Drawing.Color]::Firebrick
        return
    }

    if (-not (Test-DockerEngine)) {
        $script:StatusLabel.Text = "Docker Desktop is not running"
        $script:StatusLabel.ForeColor = [System.Drawing.Color]::DarkOrange
        return
    }

    if (Test-AppHealth) {
        $script:StatusLabel.Text = "Persian STT is running"
        $script:StatusLabel.ForeColor = [System.Drawing.Color]::DarkGreen
    } else {
        $script:StatusLabel.Text = "Persian STT is stopped or starting"
        $script:StatusLabel.ForeColor = [System.Drawing.Color]::DarkOrange
    }
}

function Run-UiAction {
    param(
        [Parameter(Mandatory = $true)][string]$BusyText,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    try {
        $script:StatusLabel.Text = $BusyText
        $script:StatusLabel.ForeColor = [System.Drawing.Color]::Black
        $script:Form.UseWaitCursor = $true
        $script:Form.Refresh()
        & $Action
    } catch {
        $script:LogBox.AppendText("`r`nERROR: $($_.Exception.Message)`r`n")
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            "Persian STT",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    } finally {
        $script:Form.UseWaitCursor = $false
        Refresh-Status
    }
}

Ensure-EnvironmentFile

$script:Form = New-Object System.Windows.Forms.Form
$script:Form.Text = "Persian STT"
$script:Form.Size = New-Object System.Drawing.Size(650, 500)
$script:Form.MinimumSize = New-Object System.Drawing.Size(650, 500)
$script:Form.StartPosition = "CenterScreen"
$script:Form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Persian Auto Transcriber"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 18)
$script:Form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Local transcription service"
$subtitle.ForeColor = [System.Drawing.Color]::DimGray
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(22, 52)
$script:Form.Controls.Add($subtitle)

$script:StatusLabel = New-Object System.Windows.Forms.Label
$script:StatusLabel.Text = "Checking status…"
$script:StatusLabel.AutoSize = $true
$script:StatusLabel.Location = New-Object System.Drawing.Point(22, 84)
$script:Form.Controls.Add($script:StatusLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "Start"
$startButton.Size = New-Object System.Drawing.Size(120, 38)
$startButton.Location = New-Object System.Drawing.Point(20, 120)
$startButton.Add_Click({
    Run-UiAction "Starting Persian STT…" {
        if (Invoke-Compose -Arguments @("up", "-d")) {
            $script:LogBox.AppendText("`r`nApplication containers started.`r`n")
        }
    }
})
$script:Form.Controls.Add($startButton)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = "Open"
$openButton.Size = New-Object System.Drawing.Size(120, 38)
$openButton.Location = New-Object System.Drawing.Point(150, 120)
$openButton.Add_Click({
    if (Test-AppHealth) {
        Start-Process $AppUrl
    } else {
        [System.Windows.Forms.MessageBox]::Show(
            "The application is not ready yet. Press Start first.",
            "Persian STT",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})
$script:Form.Controls.Add($openButton)

$updateButton = New-Object System.Windows.Forms.Button
$updateButton.Text = "Update"
$updateButton.Size = New-Object System.Drawing.Size(120, 38)
$updateButton.Location = New-Object System.Drawing.Point(280, 120)
$updateButton.Add_Click({
    Run-UiAction "Downloading update…" {
        if (Invoke-Compose -Arguments @("pull")) {
            Invoke-Compose -Arguments @("up", "-d", "--remove-orphans") | Out-Null
            $script:LogBox.AppendText("`r`nUpdate complete.`r`n")
        }
    }
})
$script:Form.Controls.Add($updateButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = "Stop"
$stopButton.Size = New-Object System.Drawing.Size(120, 38)
$stopButton.Location = New-Object System.Drawing.Point(410, 120)
$stopButton.Add_Click({
    Run-UiAction "Stopping Persian STT…" {
        Invoke-Compose -Arguments @("stop") | Out-Null
    }
})
$script:Form.Controls.Add($stopButton)

$note = New-Object System.Windows.Forms.Label
$note.Text = "For Gemini cleanup, connect your normal Windows VPN if your network requires it. Updates keep recordings, checkpoints, settings and the Whisper model."
$note.AutoSize = $false
$note.Size = New-Object System.Drawing.Size(590, 52)
$note.Location = New-Object System.Drawing.Point(20, 175)
$note.ForeColor = [System.Drawing.Color]::DimGray
$script:Form.Controls.Add($note)

$script:LogBox = New-Object System.Windows.Forms.TextBox
$script:LogBox.Multiline = $true
$script:LogBox.ReadOnly = $true
$script:LogBox.ScrollBars = "Vertical"
$script:LogBox.WordWrap = $false
$script:LogBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$script:LogBox.Location = New-Object System.Drawing.Point(20, 235)
$script:LogBox.Size = New-Object System.Drawing.Size(590, 190)
$script:LogBox.Anchor = "Top,Bottom,Left,Right"
$script:Form.Controls.Add($script:LogBox)

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = "Refresh status"
$refreshButton.Size = New-Object System.Drawing.Size(120, 28)
$refreshButton.Location = New-Object System.Drawing.Point(490, 78)
$refreshButton.Anchor = "Top,Right"
$refreshButton.Add_Click({ Refresh-Status })
$script:Form.Controls.Add($refreshButton)

$script:Form.Add_Shown({ Refresh-Status })
[void]$script:Form.ShowDialog()
