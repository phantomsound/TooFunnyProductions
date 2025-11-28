<#
.SYNOPSIS
  Full Supabase → Local PostgreSQL migration script with retries, error handling, 
  .pgpass integration, and post-migration verification.

.REQUIREMENTS
  - pg_dump, pg_restore, and psql must be in PATH
  - A valid .pgpass.conf located at $env:APPDATA\postgresql\pgpass.conf
  - Works fully hands-free once .pgpass is configured correctly
#>

param (
    [Parameter(Mandatory = $true)] [string]$SupabaseConn,
    [Parameter(Mandatory = $true)] [string]$LocalConn,
    [int]$MaxRetries = 3
)

# ============================
#   INITIAL CONFIGURATION
# ============================
$ErrorActionPreference = "Stop"
$env:PGPASSFILE = "$env:APPDATA\postgresql\pgpass.conf"
$DumpFile = "supabase_dump.sql"
$timestamp = Get-Date -Format "HH:mm:ss"

Write-Host "$timestamp | ===== Supabase → Local PostgreSQL Sync Started ====="
Write-Host "$timestamp | Supabase: $SupabaseConn"
Write-Host "$timestamp | Local: $LocalConn"
Write-Host "$timestamp | Using PGPASSFILE: $env:PGPASSFILE"

# ============================
#   COMMAND RUNNER
# ============================
function Run-Command {
    param (
        [string]$Command,
        [string]$ErrorMessage
    )

    for ($i = 1; $i -le $MaxRetries; $i++) {
        try {
            Write-Host "$(Get-Date -Format HH:mm:ss) | Attempt #$i → $Command"

            # Use CMD directly to ensure raw argument passing and correct env propagation
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "cmd.exe"
            $psi.Arguments = "/C set PGPASSFILE=$env:PGPASSFILE && $Command"
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError  = $true
            $psi.UseShellExecute        = $false
            $psi.CreateNoWindow         = $true

            $process = [System.Diagnostics.Process]::Start($psi)
            $stdout = $process.StandardOutput.ReadToEnd()
            $stderr = $process.StandardError.ReadToEnd()
            $process.WaitForExit()

            if ($process.ExitCode -eq 0) {
                if ($stdout.Trim()) { Write-Host $stdout }
                return
            } else {
                Write-Warning "Attempt #$i failed: $stderr"
                if ($i -lt $MaxRetries) {
                    Start-Sleep -Seconds 3
                } else {
                    throw "$ErrorMessage after $MaxRetries attempts.`n$stderr"
                }
            }
        } catch {
            Write-Warning "Attempt #$i failed: $_"
            if ($i -lt $MaxRetries) { Start-Sleep -Seconds 3 } else { throw $_ }
        }
    }
}

# ============================
#   MAIN MIGRATION LOGIC
# ============================
try {
    Write-Host "$(Get-Date -Format HH:mm:ss) | Dumping full schema + data from Supabase..."
    Run-Command "pg_dump --no-owner --no-privileges -Fc -f `"$DumpFile`" `"$SupabaseConn`"" "Failed to dump Supabase database"

    Write-Host "$(Get-Date -Format HH:mm:ss) | Recreating local DB 'toofunny'..."
    Run-Command "psql -d postgres -c `"DROP DATABASE IF EXISTS toofunny; CREATE DATABASE toofunny;`"" "Failed to recreate local database"

    Write-Host "$(Get-Date -Format HH:mm:ss) | Restoring dump into local database..."
    Run-Command "pg_restore --no-owner --no-privileges -d `"$LocalConn`" `"$DumpFile`"" "Failed to restore database"

    Write-Host "$(Get-Date -Format HH:mm:ss) | Post-check: verifying tables in local DB..."
    Run-Command "psql `"$LocalConn`" -c `"SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public';`"" "Post-check failed"

    Write-Host "$(Get-Date -Format HH:mm:ss) | ✅ Migration completed successfully."
}
catch {
    Write-Error "$(Get-Date -Format HH:mm:ss) | ❌ Error during migration: $_"
}
