param(
  [string]$Root = (Resolve-Path "$PSScriptRoot/..\").Path,
  [string]$Pattern = "supabase\.(co|in|net)",
  [switch]$Quiet
)

# Scan env/config files for lingering Supabase domains so we can swap them to the MikoDB/PostgREST endpoint.
$envFiles = Get-ChildItem -Path $Root -Recurse -File -Include ".env", "*.env", "*.env.*" |
  Where-Object { $_.FullName -notmatch "node_modules" }

$findings = @()
foreach ($file in $envFiles) {
  $matches = Select-String -Path $file.FullName -Pattern $Pattern -AllMatches -CaseSensitive:$false
  foreach ($match in $matches) {
    $findings += [PSCustomObject]@{
      File = $file.FullName
      Line = $match.LineNumber
      Text = $match.Line.Trim()
    }
  }
}

if ($findings.Count -eq 0) {
  if (-not $Quiet) { Write-Host "✅ No Supabase domains found in env/config files." -ForegroundColor Green }
} else {
  Write-Host "⚠️  Supabase references detected; point these to your MikoDB/PostgREST endpoint:" -ForegroundColor Yellow
  $findings | Sort-Object File, Line | Format-Table -AutoSize
}

# Optional: ping the admin status endpoint if it is reachable locally (will gracefully skip if unauthorized).
$apiUrl = "http://localhost:3000/api/admin/database/status"
try {
  $resp = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 5 -ErrorAction Stop
  Write-Host "`nLive status (requires local auth/cookie if enabled):" -ForegroundColor Cyan
  Write-Host "Friendly name:`t" $resp.friendlyName
  Write-Host "Host:`t`t" $resp.host
  Write-Host "Reachable:`t" ($resp.connectivity.ok ? "Yes" : "No")
} catch {
  if (-not $Quiet) { Write-Host "(Skipped live status check: $($_.Exception.Message))" -ForegroundColor DarkGray }
}
