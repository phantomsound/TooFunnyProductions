<#!
.SYNOPSIS
  Installs or removes NSSM services for the Too Funny Productions admin app and Cloudflare Tunnel.

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
        $argumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")

        if ($Action) {
            $argumentList += @('-Action', $Action)
        }

        Write-Host "Re-launching $shell with elevated privileges..."

        try {
            Start-Process -FilePath $shell -Verb RunAs -ArgumentList $argumentList | Out-Null
        } catch {
            throw "Unable to restart setup-services.ps1 with elevated privileges: $($_.Exception.Message)"
        }

        exit
    }
}

Ensure-Elevation

$repoRoot                = 'C:\Apps\TooFunnyProductions'
$logsRoot                = 'C:\Apps\Logs'
$nssmDir                 = 'C:\Apps\nssm\nssm-2.24\win64'
$cloudflaredDir          = 'C:\Apps\cloudflared'
$nssmExe                 = Join-Path $nssmDir 'nssm.exe'
$cloudflaredExe          = Join-Path $cloudflaredDir 'cloudflared.exe'
$nssmDownloadUrl         = 'https://nssm.cc/release/nssm-2.24.zip'
$cloudflaredDownloadUrl  = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
$nodeServiceName         = 'MikoWebAppServ'
$nodeDisplayName         = 'Too Funny Productions Admin (MikoWebAppServ)'
$legacyNodeServiceNames  = @('TFPService')
$cloudflareServiceName   = 'MikoCFTunnel'
$cloudflareDisplayName   = 'MikoCFTunnel'
$defaultTunnelName       = 'MikoHomeTunnel'
$cloudflareTunnelName    = $defaultTunnelName
$cloudflareTunnelConfig  = Join-Path $repoRoot 'cloudflared.yml'
$servicePort             = '8082'
$tfpHostnameRegex        = [regex]'(^|\.)toofunnyproductions\.com$'
$legacyTunnelServiceNames = @('TFPService-Tunnel')
$nodeExecutable          = $null

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
        throw "Failed to download $($SourceUrl): $($_.Exception.Message)"
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

function Ensure-Cloudflared {
    if (Test-Path $cloudflaredExe) {
        return
    }

    $cloudflaredTargetDir = Split-Path $cloudflaredExe -Parent
    $cloudflaredDownloadPath = Join-Path $env:TEMP 'cloudflared.exe'

    Download-File -SourceUrl $cloudflaredDownloadUrl -DestinationPath $cloudflaredDownloadPath

    if (-not (Test-Path $cloudflaredTargetDir)) {
        New-Item -ItemType Directory -Path $cloudflaredTargetDir -Force | Out-Null
    }

    Copy-Item -LiteralPath $cloudflaredDownloadPath -Destination $cloudflaredExe -Force
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

function Get-IngressHostnames {
    if (-not (Test-Path $cloudflareTunnelConfig)) {
        return @()
    }

    Select-String -Path $cloudflareTunnelConfig -Pattern '^\s*-\s*hostname:\s*(\S+)$' |
        ForEach-Object { $_.Matches[0].Groups[1].Value }
}

function Get-ExistingDnsRoutes {
    try {
        $output = & $cloudflaredExe tunnel route dns list $cloudflareTunnelName 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Unable to list Cloudflare DNS routes for $cloudflareTunnelName (exit $LASTEXITCODE)."
            return @()
        }
    } catch {
        Write-Warning "Failed to list Cloudflare DNS routes: $($_.Exception.Message)"
        return @()
    }

    $hostnames = @()
    foreach ($line in $output) {
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }
        if ($trimmed -like 'ID*') { continue }

        $parts = $trimmed -split '\s+'
        if ($parts.Length -ge 3 -and $parts[1] -match '^[A-Za-z0-9._-]+$') {
            $hostnames += $parts[1]
        }
    }

    return $hostnames
}

function Sync-DnsRoutes {
    param(
        [string[]]$DesiredHostnames
    )

    if (-not $DesiredHostnames -or $DesiredHostnames.Count -eq 0) {
        return
    }

    $existing = Get-ExistingDnsRoutes
    $desiredSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($hostname in $DesiredHostnames) {
        if ($hostname) { $desiredSet.Add($hostname) | Out-Null }
    }

    foreach ($hostname in $existing) {
        if (-not $hostname) { continue }
        if ($tfpHostnameRegex.IsMatch($hostname) -and -not $desiredSet.Contains($hostname)) {
            Write-Host "Removing stale Cloudflare DNS route for $hostname..."
            & $cloudflaredExe tunnel route dns delete $cloudflareTunnelName $hostname
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Failed to remove DNS route for $hostname. Remove manually after authenticating."
            }
        }
    }

    foreach ($hostname in $DesiredHostnames) {
        if (-not $hostname) { continue }
        Write-Host "Ensuring Cloudflare DNS route for $hostname..."
        & $cloudflaredExe tunnel route dns $cloudflareTunnelName $hostname
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to map $hostname. Run `cloudflared tunnel route dns $cloudflareTunnelName $hostname` manually after authenticating."
        }
    }
}

function Get-TunnelNameFromConfig {
    if (-not (Test-Path $cloudflareTunnelConfig)) {
        return $null
    }

    $match = Select-String -Path $cloudflareTunnelConfig -Pattern '^\s*tunnel:\s*(\S+)' -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($match) {
        return $match.Matches[0].Groups[1].Value
    }

    return $null
}

function Ensure-Path {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

Ensure-Path $logsRoot
Ensure-Path $nssmDir
Ensure-Path $cloudflaredDir

$tunnelNameFromConfig = Get-TunnelNameFromConfig
if ($tunnelNameFromConfig) {
    $cloudflareTunnelName = $tunnelNameFromConfig
}

$ingressHostnames = Get-IngressHostnames
$tfpHostnames = $ingressHostnames | Where-Object { $tfpHostnameRegex.IsMatch($_) }

if (-not (Test-Path $cloudflareTunnelConfig)) {
    Write-Warning "Cloudflare tunnel config not found at $cloudflareTunnelConfig. Update cloudflared.yml before running install."
} elseif (-not $tunnelNameFromConfig) {
    Write-Warning "No tunnel name found in cloudflared.yml. DNS routes will default to $cloudflareTunnelName until you set the `tunnel:` field."
} elseif ($ingressHostnames.Count -eq 0) {
    Write-Warning "No ingress hostnames were detected in cloudflared.yml. DNS routes will not be created automatically."
} elseif ($tfpHostnames.Count -eq 0) {
    Write-Warning "No Too Funny Productions hostnames detected in cloudflared.yml. DNS routes for TFP will be skipped."
}

switch ($Action) {
    'install' {
        Write-Host "Installing NSSM services..."

        Ensure-Nssm
        Ensure-Cloudflared
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
        $envExtras = @("PORT=$servicePort", 'NODE_ENV=production')
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

        foreach ($legacyName in $legacyTunnelServiceNames) {
            if ($legacyName -and $legacyName -ne $cloudflareServiceName) {
                Remove-ServiceIfExists -ServiceName $legacyName
            }
        }

        Remove-ServiceIfExists -ServiceName $cloudflareServiceName
        & $nssmExe install $cloudflareServiceName $cloudflaredExe '--config' $cloudflareTunnelConfig 'tunnel' 'run' $cloudflareTunnelName
        & $nssmExe set $cloudflareServiceName DisplayName $cloudflareDisplayName
        & $nssmExe set $cloudflareServiceName AppDirectory (Split-Path $cloudflaredExe -Parent)
        & $nssmExe set $cloudflareServiceName AppStdout (Join-Path $logsRoot 'cloudflared.out.log')
        & $nssmExe set $cloudflareServiceName AppStderr (Join-Path $logsRoot 'cloudflared.err.log')
        & $nssmExe set $cloudflareServiceName AppRotateFiles 1
        & $nssmExe set $cloudflareServiceName AppRotateOnline 1
        & $nssmExe set $cloudflareServiceName AppRotateSeconds 86400
        & $nssmExe set $cloudflareServiceName AppRotateBytes 10485760
        & $nssmExe set $cloudflareServiceName Start SERVICE_AUTO_START

        if ($tfpHostnames.Count -gt 0) {
            Sync-DnsRoutes -DesiredHostnames $tfpHostnames
        } elseif ($ingressHostnames.Count -gt 0) {
            Write-Warning "Skipping Cloudflare DNS automation for ingress hostnames that are not part of toofunnyproductions.com."
        }

        $cloudflareStarted = Start-ServiceAndConfirm -ServiceName $cloudflareServiceName -DisplayName $cloudflareDisplayName
        $nodeStarted = Start-ServiceAndConfirm -ServiceName $nodeServiceName -DisplayName $nodeDisplayName

        if ($cloudflareStarted -and $nodeStarted) {
            Write-Host "Services installed and started."
        } else {
            Write-Warning "Services were installed, but one or more failed to start. Check the NSSM logs in $logsRoot for details."
        }
    }
    'remove' {
        Write-Host "Stopping and removing NSSM services..."

        Remove-ServiceIfExists -ServiceName $nodeServiceName
        Remove-ServiceIfExists -ServiceName $cloudflareServiceName

        foreach ($legacyName in $legacyNodeServiceNames) {
            if ($legacyName -and $legacyName -ne $nodeServiceName) {
                Remove-ServiceIfExists -ServiceName $legacyName
            }
        }

        foreach ($legacyName in $legacyTunnelServiceNames) {
            if ($legacyName -and $legacyName -ne $cloudflareServiceName) {
                Remove-ServiceIfExists -ServiceName $legacyName
            }
        }

        Write-Host "Services removed."
    }
}
