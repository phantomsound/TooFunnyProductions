<#!
.SYNOPSIS
  Installs or removes the Too Funny Productions admin app as an NSSM service.

.PARAMETER Action
  Accepts 'install' or 'remove'. Defaults to 'install'.
#>

param(
    [ValidateSet('install', 'remove')]
    [string]$Action = 'install'
)

function Ensure-Elevation {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)

    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Warning 'Administrator access is required to install or manage Windows services.'

        $shell = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
        $argumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Action', $Action)

        Write-Host "Re-launching $shell with elevated privileges..."

        try {
            Start-Process -FilePath $shell -Verb RunAs -ArgumentList $argumentList | Out-Null
        } catch {
            throw "Unable to restart setup-nssm-service.ps1 with elevated privileges: $($_.Exception.Message)"
        }

        exit
    }
}

Ensure-Elevation

$repoRoot               = 'C:\Apps\TooFunnyProductions'
$logsRoot               = 'C:\Apps\Logs'
$nssmDir                = 'C:\Apps\nssm\nssm-2.24\win64'
$nssmExe                = Join-Path $nssmDir 'nssm.exe'
$nssmDownloadUrl        = 'https://nssm.cc/release/nssm-2.24.zip'
$nodeServiceName        = 'MikoWebAppServ'
$nodeDisplayName        = 'Too Funny Productions Admin (MikoWebAppServ)'
$legacyNodeServiceNames = @('TFPService')

$nodeExecutable = $null

function Ensure-Path {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Download-File {
    param(
        [string]$SourceUrl,
        [string]$DestinationPath
    )

    $destinationDir = Split-Path $DestinationPath -Parent
    if (-not (Test-Path $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }

    Write-Host "Downloading $SourceUrl ..."
    try {
        Invoke-WebRequest -Uri $SourceUrl -OutFile $DestinationPath -UseBasicParsing
    } catch {
        throw "Failed to download ${SourceUrl}: $($_.Exception.Message)"
    }
}

function Ensure-Nssm {
    if (Test-Path $nssmExe) {
        return
    }

    $nssmTargetDir = Split-Path $nssmExe -Parent
    $nssmZip = Join-Path $env:TEMP 'nssm.zip'

    Download-File -SourceUrl $nssmDownloadUrl -DestinationPath $nssmZip

    try {
        Expand-Archive -LiteralPath $nssmZip -DestinationPath $env:TEMP -Force
    } catch {
        throw "Failed to extract NSSM archive: $($_.Exception.Message)"
    }

    $extractedExe = Join-Path $env:TEMP 'nssm-2.24\win64\nssm.exe'
    if (-not (Test-Path $extractedExe)) {
        throw "NSSM executable not found after extraction at $extractedExe"
    }

    if (-not (Test-Path $nssmTargetDir)) {
        New-Item -ItemType Directory -Path $nssmTargetDir -Force | Out-Null
    }

    Copy-Item -LiteralPath $extractedExe -Destination $nssmExe -Force
}

function Resolve-NodeExecutable {
    if ($script:nodeExecutable) {
        return $script:nodeExecutable
    }

    try {
        $command = Get-Command node -ErrorAction Stop
        $script:nodeExecutable = $command.Source
        return $script:nodeExecutable
    } catch {
        throw 'Unable to locate the Node.js runtime. Install Node.js 18+ and ensure node.exe is on PATH.'
    }
}

function Invoke-NpmCommand {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot,
        [string]$Description
    )

    $npmExecutable = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
    if (-not (Get-Command $npmExecutable -ErrorAction SilentlyContinue)) {
        throw 'Unable to locate npm. Install Node.js 18+ and ensure npm (or npm.cmd) is available on PATH.'
    }

    if (-not $Description) {
        $Description = "npm $($Arguments -join ' ')"
    }

    Write-Host "Running $Description..."

    Push-Location $WorkingDirectory
    try {
        & $npmExecutable @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command '$Description' failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
}

function Ensure-NodeDependencies {
    $backendModulesPath = Join-Path (Join-Path $repoRoot 'backend') 'node_modules'
    $dotenvModulePath = Join-Path $backendModulesPath 'dotenv'

    if (Test-Path $dotenvModulePath) {
        Write-Host 'Detected backend Node.js dependencies (dotenv). Skipping npm install.'
        return
    }

    Invoke-NpmCommand -Arguments @('install', '--omit=dev') -Description 'npm install --omit=dev (workspace root)'
}

function Ensure-FrontendBuild {
    $frontendDist = Join-Path (Join-Path $repoRoot 'frontend') 'dist'
    $frontendIndex = Join-Path $frontendDist 'index.html'

    if (Test-Path $frontendIndex) {
        Write-Host 'Found frontend/dist/index.html. Skipping production build.'
        return
    }

    Invoke-NpmCommand -Arguments @('--prefix', 'frontend', 'run', 'build') -Description 'npm --prefix frontend run build'
}

function Remove-ServiceIfExists {
    param([string]$ServiceName)

    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Host "Service ${ServiceName} already exists. Removing before reinstall..."
        try {
            Stop-Service -Name $ServiceName -Force -ErrorAction Stop
        } catch {
            Write-Warning "Failed to stop ${ServiceName}: $($_.Exception.Message)"
        }
        & $nssmExe remove $ServiceName confirm | Out-Null
    }
}

function Start-ServiceAndConfirm {
    param(
        [string]$ServiceName,
        [string]$DisplayName,
        [int]$TimeoutSeconds = 30
    )

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Warning "Service ${ServiceName} is not installed."
        return $false
    }

    try {
        Start-Service -Name $ServiceName -ErrorAction Stop
    } catch {
        Write-Warning "Failed to start ${DisplayName}: $($_.Exception.Message)"
        return $false
    }

    $service.Refresh()

    try {
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds($TimeoutSeconds))
    } catch {
        Write-Warning "Service ${DisplayName} did not reach the Running state within $TimeoutSeconds seconds."
        return $false
    }

    return $true
}

Ensure-Path $logsRoot
Ensure-Path $nssmDir

switch ($Action) {
    'install' {
        Write-Host 'Installing NSSM service for Too Funny Productions app...'

        Ensure-Nssm
        Ensure-NodeDependencies
        Ensure-FrontendBuild

        $nodeExe = Resolve-NodeExecutable
        $startScript = Join-Path $repoRoot 'scripts\start-prod.js'
        if (-not (Test-Path $startScript)) {
            throw "Start script not found at $startScript. Run the deployment from the repo root."
        }

        Remove-ServiceIfExists -ServiceName $nodeServiceName
        & $nssmExe install $nodeServiceName $nodeExe $startScript
        & $nssmExe set $nodeServiceName DisplayName $nodeDisplayName
        & $nssmExe set $nodeServiceName AppDirectory $repoRoot
        & $nssmExe set $nodeServiceName AppStdout (Join-Path $logsRoot 'toofunny-app.out.log')
        & $nssmExe set $nodeServiceName AppStderr (Join-Path $logsRoot 'toofunny-app.err.log')
        & $nssmExe set $nodeServiceName AppRotateFiles 1
        & $nssmExe set $nodeServiceName AppRotateOnline 1
        & $nssmExe set $nodeServiceName AppRotateSeconds 86400
        & $nssmExe set $nodeServiceName AppRotateBytes 10485760

        $pathEnv = $env:PATH
        $envExtras = @("PORT=8082", 'NODE_ENV=production')
        if ($pathEnv) {
            $envExtras += "PATH=$pathEnv"
        }
        & $nssmExe set $nodeServiceName AppEnvironmentExtra ($envExtras -join "`n")
        & $nssmExe set $nodeServiceName Start SERVICE_AUTO_START
        & $nssmExe set $nodeServiceName AppExit Default Restart
        & $nssmExe set $nodeServiceName AppNoConsole 1

        foreach ($legacyName in $legacyNodeServiceNames) {
            if ($legacyName -and $legacyName -ne $nodeServiceName) {
                Remove-ServiceIfExists -ServiceName $legacyName
            }
        }

        $nodeStarted = Start-ServiceAndConfirm -ServiceName $nodeServiceName -DisplayName $nodeDisplayName

        if ($nodeStarted) {
            Write-Host 'Application service installed and started.'
        } else {
            Write-Warning "Application service was installed, but it failed to start. Check the NSSM logs in $logsRoot for detai"
            Write-Warning 'ls.'
        }
    }
    'remove' {
        Write-Host 'Stopping and removing NSSM service for Too Funny Productions app...'

        Remove-ServiceIfExists -ServiceName $nodeServiceName

        foreach ($legacyName in $legacyNodeServiceNames) {
            if ($legacyName -and $legacyName -ne $nodeServiceName) {
                Remove-ServiceIfExists -ServiceName $legacyName
            }
        }

        Write-Host 'Application services removed.'
    }
}
