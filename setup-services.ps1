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
$toolsRoot               = 'C:\Apps\Tools'
$nssmExe                 = Join-Path $toolsRoot 'nssm\nssm.exe'
$cloudflaredExe          = Join-Path $toolsRoot 'cloudflared\cloudflared.exe'
$nodeServiceName         = 'TFPService'
$nodeDisplayName         = 'Too Funny Productions Admin (TFPService)'
$cloudflareServiceName   = 'TFPService-Tunnel'
$cloudflareDisplayName   = 'TFPService Cloudflare Tunnel'
$defaultTunnelName       = 'MikoHomeTunnel'
$cloudflareTunnelName    = $defaultTunnelName
$cloudflareTunnelConfig  = Join-Path $repoRoot 'cloudflared.yml'
$tfpHostnameRegex        = [regex]'(^|\.)toofunnyproductions\.com$'

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

        Remove-ServiceIfExists -ServiceName $nodeServiceName
        & $nssmExe install $nodeServiceName "$env:ComSpec" "/c npm run start"
        & $nssmExe set $nodeServiceName DisplayName $nodeDisplayName
        & $nssmExe set $nodeServiceName AppDirectory $repoRoot
        & $nssmExe set $nodeServiceName AppStdout (Join-Path $logsRoot 'toofunny-app.out.log')
        & $nssmExe set $nodeServiceName AppStderr (Join-Path $logsRoot 'toofunny-app.err.log')
        & $nssmExe set $nodeServiceName AppRotateFiles 1
        & $nssmExe set $nodeServiceName AppRotateOnline 1
        & $nssmExe set $nodeServiceName AppRotateSeconds 86400
        & $nssmExe set $nodeServiceName AppRotateBytes 10485760
        & $nssmExe set $nodeServiceName AppEnvironmentExtra "PORT=8081`nNODE_ENV=production"
        & $nssmExe set $nodeServiceName Start SERVICE_AUTO_START

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
            foreach ($hostname in $tfpHostnames) {
                Write-Host "Ensuring Cloudflare DNS route for $hostname..."
                & $cloudflaredExe tunnel route dns $cloudflareTunnelName $hostname
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "Failed to map $hostname. Run `cloudflared tunnel route dns $cloudflareTunnelName $hostname` manually after authenticating."
                }
            }
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

        if (Get-Service -Name $nodeServiceName -ErrorAction SilentlyContinue) {
            Stop-Service $nodeServiceName -ErrorAction SilentlyContinue
            & $nssmExe remove $nodeServiceName confirm
        }

        if (Get-Service -Name $cloudflareServiceName -ErrorAction SilentlyContinue) {
            Stop-Service $cloudflareServiceName -ErrorAction SilentlyContinue
            & $nssmExe remove $cloudflareServiceName confirm
        }

        Write-Host "Services removed."
    }
}
