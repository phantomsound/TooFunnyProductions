param(
  [string]$Root = (Resolve-Path "$PSScriptRoot/..\").Path,
  [switch]$Quiet
)

$backendEnv = Join-Path $Root "backend\.env"
$frontendEnv = Join-Path $Root "frontend\.env"

function Read-EnvValue {
  param(
    [string]$Path,
    [string]$Key
  )
  if (!(Test-Path $Path)) { return "" }
  $line = Get-Content $Path | Where-Object { $_ -match "^$Key=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  $value = $line -replace "^$Key=", ""
  return $value.Trim('"')
}

function PresentOrMissing {
  param([string]$Value)
  if ($Value -ne "") { return "<present>" }
  return "<missing>"
}

function ValueOrMissing {
  param([string]$Value)
  if ($Value -ne "") { return $Value }
  return "<missing>"
}

if (-not $Quiet) { Write-Host "== Local Supabase/PostgREST Check ==" }

$supabaseUrl = Read-EnvValue -Path $backendEnv -Key "SUPABASE_URL"
$serviceKey = Read-EnvValue -Path $backendEnv -Key "SUPABASE_SERVICE_KEY"
$viteSupabaseUrl = Read-EnvValue -Path $frontendEnv -Key "VITE_SUPABASE_URL"
$viteAnonKey = Read-EnvValue -Path $frontendEnv -Key "VITE_SUPABASE_ANON_KEY"

if (Test-Path $backendEnv) {
  Write-Host ("Backend SUPABASE_URL: " + (ValueOrMissing $supabaseUrl))
  Write-Host ("Backend SUPABASE_SERVICE_KEY: " + (PresentOrMissing $serviceKey))
} else {
  Write-Host "❌ Missing backend/.env"
}

if (Test-Path $frontendEnv) {
  Write-Host ("Frontend VITE_SUPABASE_URL: " + (ValueOrMissing $viteSupabaseUrl))
  Write-Host ("Frontend VITE_SUPABASE_ANON_KEY: " + (PresentOrMissing $viteAnonKey))
} else {
  Write-Host "❌ Missing frontend/.env"
}

if ($supabaseUrl -ne "") {
  Write-Host "Checking reachability of SUPABASE_URL..."
  try {
    Invoke-WebRequest -Uri $supabaseUrl -TimeoutSec 5 | Out-Null
    Write-Host "✅ SUPABASE_URL reachable"
  } catch {
    Write-Host "❌ SUPABASE_URL not reachable (service down, firewall, or wrong host/port)"
  }
} else {
  Write-Host "⚠️  SUPABASE_URL is empty; backend will fall back to file-based storage."
}

if ($viteSupabaseUrl -ne "" -and $supabaseUrl -eq "") {
  Write-Host "⚠️  Frontend has Supabase URL but backend does not. Keep them aligned."
}

if (Get-Command Test-NetConnection -ErrorAction SilentlyContinue) {
  try {
    $pgTest = Test-NetConnection -ComputerName "127.0.0.1" -Port 5432 -WarningAction SilentlyContinue
    if ($pgTest.TcpTestSucceeded) {
      Write-Host "✅ PostgreSQL port 5432 reachable on localhost"
    } else {
      Write-Host "⚠️  PostgreSQL port 5432 not reachable on localhost"
    }
  } catch {
    Write-Host "⚠️  Skipped PostgreSQL port test: $($_.Exception.Message)"
  }
}

if (-not $Quiet) { Write-Host "== Done ==" }
