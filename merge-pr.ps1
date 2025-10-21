<#  merge-pr.ps1
    One-command PR merge helper for TooFunnyProductions.

    Usage:
      # Auto-pick the newest origin/codex/* branch
      ./merge-pr.ps1

      # Specify a branch explicitly
      ./merge-pr.ps1 -Branch codex/identify-next-steps-for-project-development-abc123

      # Use a PR number (requires GitHub CLI `gh`)
      ./merge-pr.ps1 -PrNumber 42

      # Keep the remote branch after merge
      ./merge-pr.ps1 -Branch codex/... -KeepBranch

    Behavior:
      - Ensures clean working tree
      - Fetches/prunes remotes
      - Determines the PR branch (Branch arg > PrNumber via gh > newest origin/codex/*)
      - Checks out PR branch (tracking remote), builds & doctor checks
      - Merges into main with `-X theirs` (PR wins on conflicts), pushes
      - Optionally deletes PR branch (local + remote)
#>

[CmdletBinding()]
param(
  [string] $Branch,
  [int]    $PrNumber,
  [switch] $KeepBranch
)

$ErrorActionPreference = 'Stop'

function Assert-CleanTree {
  $status = git status --porcelain
  if ($status) {
    throw "Working tree not clean. Stash or commit first.`n$($status)"
  }
}

function Ensure-AtRepoRoot {
  if (-not (Test-Path ".git")) {
    throw "Run this from the repo root (a .git folder must exist). Current: $(Get-Location)"
  }
}

function Fetch-All {
  git fetch --all --prune | Out-Host
}

function Resolve-Branch {
  param([string]$Branch, [int]$PrNumber)

  if ($Branch) { return $Branch }

  # Try PR number via gh
  if ($PrNumber) {
    try {
      git rev-parse --is-inside-work-tree *> $null
      # gh will create/track a local branch for the PR
      gh pr checkout $PrNumber | Out-Host
      $b = (git branch --show-current).Trim()
      if (-not $b) { throw "gh pr checkout did not set a current branch." }
      return $b
    } catch {
      throw "Failed to checkout PR #$PrNumber via gh. $_"
    }
  }

  # Auto-pick newest origin/codex/* by committerdate
  $cand = git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/remotes/origin/codex/* |
          Select-Object -First 1
  if (-not $cand) { throw "No origin/codex/* branches found." }

  # Return short (without origin/) for local switch
  return ($cand -replace '^origin/','')
}

function Checkout-Tracking {
  param([string]$Branch)

  # Does the local branch already exist?
  $exists = (git branch --list $Branch) -ne $null -and (git branch --list $Branch).Trim().Length -gt 0

  if (-not $exists) {
    # Create a new local branch that tracks the remote PR branch
    git switch -c $Branch --track origin/$Branch | Out-Host
  } else {
    # Use the existing local branch and ensure it tracks the right remote
    git switch $Branch | Out-Host
    git branch --set-upstream-to=origin/$Branch $Branch | Out-Host
    git pull | Out-Host
  }
}


function Clear-Esbuild-Lock {
  # Kill stray processes & remove locked esbuild to allow clean installs, best-effort
  $esbuildPath = "frontend\node_modules\@esbuild\win32-x64\esbuild.exe"
  try { taskkill /F /IM esbuild.exe 2>$null | Out-Null } catch {}
  try { taskkill /F /IM node.exe    2>$null | Out-Null } catch {}
  if (Test-Path $esbuildPath) {
    try { Remove-Item -Force $esbuildPath -ErrorAction SilentlyContinue } catch {}
  }
}

function Build-And-Doctor {
  param([switch]$FreshInstall)

  if ($FreshInstall) {
    Clear-Esbuild-Lock
    npm ci --prefix frontend | Out-Host
  } else {
    # Fast path; if you want always-fresh, pass -FreshInstall
    npm ci --prefix frontend | Out-Host
  }

  npm run build --prefix frontend | Out-Host

  # Root doctor (not under frontend)
  if ((npm run | Select-String -SimpleMatch "doctor").Length -gt 0) {
    npm run doctor | Out-Host
  }
}

function Merge-To-Main {
  param([string]$Branch)

  git switch main | Out-Host
  git pull origin main | Out-Host

  # Merge with PR winning on conflicts
  git merge --no-edit -X theirs $Branch | Out-Host
  git push origin main | Out-Host

  # Verify sync
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse origin/main).Trim()
  if ($local -ne $remote) {
    throw "Post-merge SHA mismatch. Local: $local  Remote: $remote"
  }
}

function Cleanup-Branch {
  param([string]$Branch, [switch]$Keep)
  if ($Keep) { return }
  try { git branch -d $Branch | Out-Host } catch {}
  try { git push origin --delete $Branch | Out-Host } catch {}
  git fetch --all --prune | Out-Host
}

# ----- Main flow -----
try {
  Ensure-AtRepoRoot
  Assert-CleanTree
  Fetch-All

  $resolved = Resolve-Branch -Branch $Branch -PrNumber $PrNumber
  Write-Host ("`n>>> Using PR branch: {0}`n" -f $resolved) -ForegroundColor Cyan

  Checkout-Tracking -Branch $resolved

  # Build/test on PR branch
  Build-And-Doctor -FreshInstall

  # Merge & push
  Merge-To-Main -Branch $resolved

  # Final build/doctor on main for sanity
  Build-And-Doctor

  Cleanup-Branch -Branch $resolved -Keep:$KeepBranch

  Write-Host "`n✅ Merge complete. main is up to date and builds clean." -ForegroundColor Green
  Write-Host "   You can now run:  npm run dev" -ForegroundColor DarkGray
}
catch {
  Write-Host "`n❌ Error: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   If you were dropped into an editor (Vim), press Esc then :wq Enter to continue."
  exit 1
}
