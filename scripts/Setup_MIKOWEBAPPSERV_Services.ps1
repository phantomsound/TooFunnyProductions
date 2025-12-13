<#
.SYNOPSIS
    Sets up application dependencies and NSSM services on the MIKOWEBAPPSERV host.

.DESCRIPTION
    Installs Node/Python dependencies for applications copied from MIKOHOME, ensures
    Python virtual environments exist for Melbot and MonitorSite, and recreates the
    NSSM services for the following processes:
      - TFPService (Too Funny Productions admin)
      - KBBGService
      - Melbot
      - MonitorSite
      - MikoCFTunnel (TooFunny Cloudflare tunnel)
      - KBBGTunnel (KBBG Cloudflare tunnel)

.PARAMETER NssmPath
    Full path to nssm.exe. Defaults to C:\Apps\nssm\nssm.exe.

.PARAMETER CloudflaredExe
    Full path to cloudflared.exe. Defaults to C:\Apps\cloudflared\cloudflared.exe.

.PREREQUISITES
    - C:\Apps exists and contains:
        C:\Apps\TooFunnyProductions
        C:\Apps\Melbot
        C:\Apps\Config\cloudflared\...
        C:\Apps\MonitorSite
        C:\Apps\KBBG (or your chosen KBBG folder)
    - NSSM located at C:\Apps\nssm\nssm.exe (adjust $NssmPath if different)
    - cloudflared.exe located at C:\Apps\cloudflared\cloudflared.exe
    - Node.js and Python 3 installed and on PATH
#>
param(
    [string]$NssmPath = "C:\Apps\nssm\nssm.exe",
    [string]$CloudflaredExe = "C:\Apps\cloudflared\cloudflared.exe"
)

Write-Host "=== Setup_MIKOWEBAPPSERV_Services ===" -ForegroundColor Cyan

if (-not (Test-Path $NssmPath)) {
    Write-Host "ERROR: NSSM not found at $NssmPath" -ForegroundColor Red
    exit 1
}

$logsDir = "C:\Apps\logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
    Write-Host "Created logs directory at $logsDir" -ForegroundColor Green
}

function Run-Command {
    param(
        [string]$Command,
        [string]$WorkingDir
    )

    if ($WorkingDir) { Push-Location $WorkingDir }
    Write-Host ">> $Command" -ForegroundColor DarkCyan
    Invoke-Expression $Command
    if ($WorkingDir) { Pop-Location }
}

# 1) Too Funny Productions – install deps & build
$tfpRoot = "C:\Apps\TooFunnyProductions"
if (Test-Path $tfpRoot) {
    Write-Host "--- Setting up TooFunnyProductions ---" -ForegroundColor Yellow
    $tfpBackend = Join-Path $tfpRoot "backend"
    $tfpFrontend = Join-Path $tfpRoot "frontend"

    if (Test-Path (Join-Path $tfpBackend "package.json")) {
        Write-Host "Installing backend deps..." -ForegroundColor Yellow
        Run-Command -Command "npm install" -WorkingDir $tfpBackend
    } else {
        Write-Host "No backend package.json found at $tfpBackend, skipping npm install." -ForegroundColor DarkYellow
    }

    if (Test-Path (Join-Path $tfpFrontend "package.json")) {
        Write-Host "Installing frontend deps..." -ForegroundColor Yellow
        Run-Command -Command "npm install" -WorkingDir $tfpFrontend
        Write-Host "Building frontend..." -ForegroundColor Yellow
        Run-Command -Command "npm run build" -WorkingDir $tfpFrontend
    } else {
        Write-Host "No frontend package.json found at $tfpFrontend, skipping npm steps." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "Skipping TooFunnyProductions; folder not found at $tfpRoot" -ForegroundColor DarkYellow
}

# 2) KBBG – install deps & build (adjust folder as needed)
$kbbgRoot = "C:\Apps\KBBG"  # If you used a different folder name, edit this
if (Test-Path $kbbgRoot) {
    Write-Host "--- Setting up KBBG ---" -ForegroundColor Yellow
    if (Test-Path (Join-Path $kbbgRoot "package.json")) {
        Run-Command -Command "npm install" -WorkingDir $kbbgRoot
        # Add npm build/start commands here if needed, e.g.:
        # Run-Command -Command "npm run build" -WorkingDir $kbbgRoot
    } else {
        Write-Host "No package.json found at $kbbgRoot; check KBBG project structure." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "Skipping KBBG; folder not found at $kbbgRoot" -ForegroundColor DarkYellow
}

# 3) Melbot – Python venv & deps
$melbotRoot = "C:\Apps\Melbot"
$melbotVenv = Join-Path $melbotRoot ".venv\Scripts\python.exe"
if (Test-Path $melbotRoot) {
    Write-Host "--- Setting up Melbot ---" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $melbotRoot ".venv"))) {
        Write-Host "Creating Melbot virtual environment..." -ForegroundColor Yellow
        Run-Command -Command "python -m venv .venv" -WorkingDir $melbotRoot
    }

    if (Test-Path (Join-Path $melbotRoot "requirements.txt")) {
        Write-Host "Installing Melbot requirements..." -ForegroundColor Yellow
        Run-Command -Command ".\.venv\Scripts\python.exe -m pip install --upgrade pip" -WorkingDir $melbotRoot
        Run-Command -Command ".\.venv\Scripts\python.exe -m pip install -r requirements.txt" -WorkingDir $melbotRoot
    } else {
        Write-Host "No requirements.txt found for Melbot; install deps manually if needed." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "Skipping Melbot; folder not found at $melbotRoot" -ForegroundColor DarkYellow
}

# 4) MonitorSite – Python venv & deps
$monitorRoot = "C:\Apps\MonitorSite"
$monitorScript = Join-Path $monitorRoot "monitor_site.py"
if ((Test-Path $monitorRoot) -and (Test-Path $monitorScript)) {
    Write-Host "--- Setting up MonitorSite ---" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $monitorRoot ".venv"))) {
        Write-Host "Creating MonitorSite virtual environment..." -ForegroundColor Yellow
        Run-Command -Command "python -m venv .venv" -WorkingDir $monitorRoot
    }

    if (Test-Path (Join-Path $monitorRoot "requirements.txt")) {
        Write-Host "Installing MonitorSite requirements..." -ForegroundColor Yellow
        Run-Command -Command ".\.venv\Scripts\python.exe -m pip install --upgrade pip" -WorkingDir $monitorRoot
        Run-Command -Command ".\.venv\Scripts\python.exe -m pip install -r requirements.txt" -WorkingDir $monitorRoot
    } else {
        Write-Host "No requirements.txt found for MonitorSite; install deps manually if needed." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "Skipping MonitorSite; monitor_site.py not found at $monitorScript" -ForegroundColor DarkYellow
}

# 5) Create NSSM services
$NSSM = $NssmPath

# 5.1 TFPService (Too Funny Productions Admin)
if (Test-Path $tfpRoot) {
    Write-Host "--- Creating TFPService ---" -ForegroundColor Yellow
    & $NSSM install TFPService "C:\Apps\TooFunnyProductions\start-toofunny.cmd" "C:\Apps\TooFunnyProductions\scripts\start-prod.js"
    & $NSSM set TFPService AppDirectory "C:\Apps\TooFunnyProductions"
    & $NSSM set TFPService AppStdout "$logsDir\TFPService.log"
    & $NSSM set TFPService AppStderr "$logsDir\TFPService.err.log"
    & $NSSM set TFPService Start SERVICE_AUTO_START
    & $NSSM start TFPService
}

# 5.2 KBBGService
$KbbgAppExe    = "C:\Program Files\nodejs\node.exe"   # EDIT IF DIFFERENT
$KbbgAppParams = "C:\Apps\KBBG\index.js"              # EDIT IF DIFFERENT
if ((Test-Path $kbbgRoot) -and (Test-Path $KbbgAppExe)) {
    Write-Host "--- Creating KBBGService ---" -ForegroundColor Yellow
    & $NSSM install KBBGService $KbbgAppExe $KbbgAppParams
    & $NSSM set KBBGService AppDirectory $kbbgRoot
    & $NSSM set KBBGService AppStdout "$logsDir\KBBGService.log"
    & $NSSM set KBBGService AppStderr "$logsDir\KBBGService.err.log"
    & $NSSM set KBBGService Start SERVICE_AUTO_START
    & $NSSM start KBBGService
} else {
    Write-Host "Skipping KBBGService; check KBBG paths and exe." -ForegroundColor DarkYellow
}

# 5.3 Melbot service
if (Test-Path $melbotVenv) {
    Write-Host "--- Creating Melbot service ---" -ForegroundColor Yellow
    & $NSSM install Melbot $melbotVenv "-m app.main"
    & $NSSM set Melbot AppDirectory $melbotRoot
    & $NSSM set Melbot AppStdout "$logsDir\Melbot.log"
    & $NSSM set Melbot AppStderr "$logsDir\Melbot.err.log"
    & $NSSM set Melbot Start SERVICE_AUTO_START
    & $NSSM start Melbot
} else {
    Write-Host "Skipping Melbot NSSM install; venv python not found at $melbotVenv" -ForegroundColor DarkYellow
}

# 5.4 MonitorSite service
$monitorPython = Join-Path $monitorRoot ".venv\Scripts\python.exe"
if ((Test-Path $monitorPython) -and (Test-Path $monitorScript)) {
    Write-Host "--- Creating MonitorSite service ---" -ForegroundColor Yellow
    & $NSSM install MonitorSite $monitorPython $monitorScript
    & $NSSM set MonitorSite AppDirectory $monitorRoot
    & $NSSM set MonitorSite AppStdout "$logsDir\MonitorSite.log"
    & $NSSM set MonitorSite AppStderr "$logsDir\MonitorSite.err.log"
    & $NSSM set MonitorSite Start SERVICE_AUTO_START
    & $NSSM start MonitorSite
} else {
    Write-Host "Skipping MonitorSite NSSM install; check venv and script paths." -ForegroundColor DarkYellow
}

# 5.5 Cloudflare tunnels – MikoCFTunnel and KBBGTunnel
$toofunnyCfg = "C:\Apps\Config\cloudflared\toofunny\config.yml"
$kbbgCfg     = "C:\Apps\Config\cloudflared\kbbg\config.yml"
$toofunnyTunnelId = "fd4fa654-9459-4c4c-8fc3-e9ecf892b04c"
$kbbgTunnelId     = "20b316d7-3fc4-4481-a7e6-1f6dc40d4d51"

if ((Test-Path $CloudflaredExe) -and (Test-Path $toofunnyCfg)) {
    Write-Host "--- Creating MikoCFTunnel ---" -ForegroundColor Yellow
    & $NSSM install MikoCFTunnel $CloudflaredExe "tunnel --config $toofunnyCfg run $toofunnyTunnelId"
    & $NSSM set MikoCFTunnel AppDirectory "C:\Apps\Config\cloudflared\toofunny"
    & $NSSM set MikoCFTunnel AppStdout "$logsDir\MikoCFTunnel.log"
    & $NSSM set MikoCFTunnel AppStderr "$logsDir\MikoCFTunnel.err.log"
    & $NSSM set MikoCFTunnel Start SERVICE_AUTO_START
    & $NSSM start MikoCFTunnel
} else {
    Write-Host "Skipping MikoCFTunnel; check cloudflared exe or toofunny config path." -ForegroundColor DarkYellow
}

if ((Test-Path $CloudflaredExe) -and (Test-Path $kbbgCfg)) {
    Write-Host "--- Creating KBBGTunnel ---" -ForegroundColor Yellow
    & $NSSM install KBBGTunnel $CloudflaredExe "tunnel --config $kbbgCfg run $kbbgTunnelId"
    & $NSSM set KBBGTunnel AppDirectory "C:\Apps\Config\cloudflared\kbbg"
    & $NSSM set KBBGTunnel AppStdout "$logsDir\KBBGTunnel.log"
    & $NSSM set KBBGTunnel AppStderr "$logsDir\KBBGTunnel.err.log"
    & $NSSM set KBBGTunnel Start SERVICE_AUTO_START
    & $NSSM start KBBGTunnel
} else {
    Write-Host "Skipping KBBGTunnel; check cloudflared exe or kbbg config path." -ForegroundColor DarkYellow
}

Write-Host "=== Setup_MIKOWEBAPPSERV_Services complete. ===" -ForegroundColor Cyan
Write-Host "Check services with: Get-Service TFPService, KBBGService, Melbot, MonitorSite, MikoCFTunnel, KBBGTunnel" -ForegroundColor Cyan
