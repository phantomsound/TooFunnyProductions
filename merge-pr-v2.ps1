<#  merge-pr-v2.ps1
    One-command PR merge helper for TooFunnyProductions (batch-capable).

    Quick usage:
      ./merge-pr-v2.ps1                         # merge newest origin/codex/* PR
      ./merge-pr-v2.ps1 -Count 3                # merge 3 newest Codex PRs (oldest->newest)
      ./merge-pr-v2.ps1 -All                    # merge ALL origin/codex/* PRs
      ./merge-pr-v2.ps1 -Branch codex/xyz       # merge a specific branch
      ./merge-pr-v2.ps1 -PrNumber 42            # merge PR # via gh pr checkout
      ./merge-pr-v2.ps1 -KeepBranch             # don't delete branches after merge
      ./merge-pr-v2.ps1 -Pattern "codex/*next*" # filter branches by wildcard
      ./merge-pr-v2.ps1 -DryRun                 # show what would happen

    Behavior:
      - Ensures clean tree (ignores changes to this script)
      - Fetches/prunes
      - Resolves branch list (Branch > PrNumber > Pattern/Count/All > newest codex/*)
      - For each branch (oldest->newest to minimize conflicts):
          * checkout/track, npm ci/build, npm run doctor
          * merge into main with `-X theirs`, push
          * optionally delete local+remote branch
      - Final build/doctor on main
#>

[CmdletBinding()]
param(
  [string] $Branch,
  [int]    $PrNumber,
  [switch] $All,
  [int]    $Count = 1,
  [string] $Pattern = "codex/*",
  [switch] $KeepBranch,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# Ensure UTF-8 output so downstream tools (like npm run doctor) render symbols correctly
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # Ignore encoding errors; fallback to default console encoding
}
$script:didSelfStash = $false

function Ensure-AtRepoRoot {
  if (-not (Test-Path ".git")) { throw "Run from repo root ('.git' required). Current: $(Get-Location)" }
}

function AutoStash-ThisScript {
  $selfDirty = git status --porcelain | Where-Object { $_ -match "\smerge-pr-v2\.ps1$" }
  if ($selfDirty) { git stash push -m "auto: merge-pr-v2.ps1" -- merge-pr-v2.ps1 | Out-Host; $script:didSelfStash = $true }
}

function AutoUnstash-ThisScript {
  if ($script:didSelfStash) { try { git stash pop | Out-Host } catch {} }
}

function Assert-CleanTree {
  # ignore this script being modified
  $status = git status --porcelain | Where-Object { $_ -notmatch "\smerge-pr-v2\.ps1$" }
  if ($status) {
    $details = $status -join "`n"
    $tips = @(
      "Tips:",
      " - Keep changes: git add <path>...; git commit -m \"save WIP\"",
      " - Discard tracked edits: git restore --staged --worktree <path>...",
      " - Drop untracked dumps/logs: git clean -fd -- <path-or-folder>",
      " - Temporary stash everything: git stash push -m \"merge-pr prep\""
    ) -join "`n"
    throw "Working tree not clean (excluding merge-pr-v2.ps1). Stash/commit first.`n$details`n`n$tips"
  }
}

function Fetch-All { git fetch --all --prune | Out-Host }

function Resolve-Branches {
  param([string]$Branch, [int]$PrNumber, [switch]$All, [int]$Count, [string]$Pattern)

  # explicit branch
  if ($Branch) { return @($Branch) }

  # GH PR number
  if ($PrNumber) {
    try {
      gh pr checkout $PrNumber | Out-Host
      $b = (git branch --show-current).Trim()
      if (-not $b) { throw "gh pr checkout didn't set a current branch." }
      return @($b)
    } catch { throw "Failed to checkout PR #$PrNumber via gh. $_" }
  }

  # collect remote branches by pattern (default codex/*), newest first by committerdate
  $remotes = git for-each-ref --sort=-committerdate --format='%(refname:short)' "refs/remotes/origin/$Pattern"
  if (-not $remotes) { throw "No origin/$Pattern branches found." }

  # strip origin/ prefix; choose how many
  $short = $remotes | ForEach-Object { $_ -replace '^origin/','' }
  if ($All) { return $short }
  return $short | Select-Object -First $Count
}

function Checkout-Tracking {
  param([string]$Branch)
  $exists = ((git branch --list $Branch) | Out-String).Trim().Length -gt 0
  if (-not $exists) {
    git switch -c $Branch --track origin/$Branch | Out-Host
  } else {
    git switch $Branch | Out-Host
    git branch --set-upstream-to=origin/$Branch $Branch | Out-Host
    git pull | Out-Host
  }
}

function Clear-Esbuild-Lock {
  try { taskkill /F /IM esbuild.exe 2>$null | Out-Null } catch {}
  try { taskkill /F /IM node.exe    2>$null | Out-Null } catch {}
  $es = "frontend\node_modules\@esbuild\win32-x64\esbuild.exe"
  if (Test-Path $es) { try { Remove-Item -Force $es -ErrorAction SilentlyContinue } catch {} }
}

function Build-And-Doctor {
  Clear-Esbuild-Lock
  npm ci --prefix frontend | Out-Host
  npm run build --prefix frontend | Out-Host

  # root doctor if present
  if ((npm run | Select-String -SimpleMatch "doctor").Length -gt 0) { npm run doctor | Out-Host }
}

function Merge-To-Main {
  param([string]$Branch, [switch]$DryRun)
  git switch main | Out-Host
  git pull origin main | Out-Host
  if ($DryRun) { Write-Host "[DRYRUN] would: git merge --no-edit -X theirs $Branch" -ForegroundColor Yellow; return }
  git merge --no-edit -X theirs $Branch | Out-Host
  git push origin main | Out-Host

  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse origin/main).Trim()
  if ($local -ne $remote) { throw "Post-merge SHA mismatch. Local: $local  Remote: $remote" }
}

function Cleanup-Branch {
  param([string]$Branch, [switch]$Keep)
  if ($Keep) { return }
  try { git branch -d $Branch | Out-Host } catch {}
  try { git push origin --delete $Branch | Out-Host } catch {}
}

function Show-PostMergeTips {
  Write-Host "`n[Next steps]" -ForegroundColor Yellow
  Write-Host "   - Run 'git status' to confirm only the files you intend to keep remain staged or modified." -ForegroundColor Yellow
  Write-Host "   - Use 'git add <file>' to keep a change or 'git restore --staged/--worktree <file>' to discard it." -ForegroundColor Yellow
  Write-Host "   - If the Supabase migration removed unsupported extensions, edit docs/schema/supabase_schema.sql to match the sanitized output." -ForegroundColor Yellow
  Write-Host "   - Commit and push your follow-up fixes before re-running this helper." -ForegroundColor Yellow
}

# -------- Main --------
try {
  Ensure-AtRepoRoot
  AutoStash-ThisScript
  Assert-CleanTree
  Fetch-All

  $branches = Resolve-Branches -Branch $Branch -PrNumber $PrNumber -All:$All -Count:$Count -Pattern $Pattern
  # Merge oldest -> newest to reduce conflicts
  $branches = @($branches)[-1..-($branches.Count)]  # reverse array

  Write-Host "`n>>> Will process branches (oldest->newest):" -ForegroundColor Cyan
  $branches | ForEach-Object { Write-Host " - $_" -ForegroundColor Cyan }

  foreach ($b in $branches) {
    Write-Host "`n=== Processing $b ===" -ForegroundColor Green
    Checkout-Tracking -Branch $b
    Build-And-Doctor
    Merge-To-Main -Branch $b -DryRun:$DryRun
    if (-not $DryRun) { Cleanup-Branch -Branch $b -Keep:$KeepBranch }
    Fetch-All
  }

  # final sanity on main
  git switch main | Out-Host
  if (-not $DryRun) { Build-And-Doctor }

  Write-Host "`n[Done] main is up to date and builds clean." -ForegroundColor Green
  Write-Host "   You can run: npm run dev" -ForegroundColor DarkGray
  if (-not $DryRun) { Show-PostMergeTips }
}
catch {
  Write-Host "`n[Error] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   If an editor opened, press Esc then :wq Enter to continue."
  exit 1
}
finally {
  AutoUnstash-ThisScript
}
