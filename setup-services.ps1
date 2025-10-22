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

$repoRoot                = 'C:\Apps\TooFunnyProductions'
$logsRoot                = 'C:\Apps\Logs'
$toolsRoot               = 'C:\Apps\Tools'
$nssmExe                 = Join-Path $toolsRoot 'nssm\nssm.exe'
$cloudflaredExe          = Join-Path $toolsRoot 'cloudflared\cloudflared.exe'
$nodeServiceName         = 'TFPService'
$nodeDisplayName         = 'Too Funny Productions Admin (TFPService)'
$cloudflareServiceName   = 'TFPService-Tunnel'
$cloudflareDisplayName   = 'TFPService Cloudflare Tunnel'
$cloudflareTunnelName    = 'MikoCFTunnel'
$cloudflareTunnelConfig  = Join-Path $repoRoot 'cloudflared.yml'

function Ensure-Path {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

Ensure-Path $logsRoot

if (-not (Test-Path $cloudflareTunnelConfig)) {
    Write-Warning "Cloudflare tunnel config not found at $cloudflareTunnelConfig. Update cloudflared.yml before running install."
}

switch ($Action) {
    'install' {
        Write-Host "Installing NSSM services..."

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

        & $nssmExe install $cloudflareServiceName $cloudflaredExe "tunnel run $cloudflareTunnelName --config `"$cloudflareTunnelConfig`""
        & $nssmExe set $cloudflareServiceName DisplayName $cloudflareDisplayName
        & $nssmExe set $cloudflareServiceName AppDirectory (Split-Path $cloudflaredExe -Parent)
        & $nssmExe set $cloudflareServiceName AppStdout (Join-Path $logsRoot 'cloudflared.out.log')
        & $nssmExe set $cloudflareServiceName AppStderr (Join-Path $logsRoot 'cloudflared.err.log')
        & $nssmExe set $cloudflareServiceName AppRotateFiles 1
        & $nssmExe set $cloudflareServiceName AppRotateOnline 1
        & $nssmExe set $cloudflareServiceName AppRotateSeconds 86400
        & $nssmExe set $cloudflareServiceName AppRotateBytes 10485760
        & $nssmExe set $cloudflareServiceName Start SERVICE_AUTO_START

        Start-Service $cloudflareServiceName
        Start-Service $nodeServiceName

        Write-Host "Services installed and started."
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
