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

$script:AutoStashRef = $null

function Assert-CleanTree {
  $status = git status --porcelain
  if (-not $status) { return }

  Write-Host "`n⚠️  Working tree has local changes that will block the merge script." -ForegroundColor Yellow
  Write-Host "   Current status:" -ForegroundColor Yellow
  git status -sb | Out-Host

  $stashList = git stash list
  if ($stashList) {
    Write-Host "`n   Existing stash entries:" -ForegroundColor Yellow
    git stash list | Out-Host
  } else {
    Write-Host "`n   No stashes are currently saved." -ForegroundColor Yellow
  }

  while ($true) {
    Write-Host "`nChoose how to proceed:" -ForegroundColor Yellow
    Write-Host "  [S] Stash changes now (will be re-applied automatically after the merge)." -ForegroundColor Yellow
    Write-Host "  [C] Commit changes now (requires a commit message)." -ForegroundColor Yellow
    Write-Host "  [D] Discard ALL local changes (git reset --hard + git clean -fd)." -ForegroundColor Yellow
    Write-Host "  [I] Ignore changes and continue without stashing (may cause checkout/merge conflicts)." -ForegroundColor Yellow
    Write-Host "  [A] Abort the merge helper so you can handle the changes yourself." -ForegroundColor Yellow

    $choice = (Read-Host "Enter S, C, D, I, or A").Trim().ToUpper()
    switch ($choice) {
      'S' {
        $customMessage = (Read-Host "Optional stash message (press Enter to skip)").Trim()
        if (-not $customMessage) {
          $customMessage = "merge-pr auto-stash $(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
        }

        git stash push --include-untracked -m $customMessage | Out-Host

        $stashEntry = git stash list --format="%gd::%gs" | Where-Object { $_ -like "*${customMessage}*" } | Select-Object -First 1
        if (-not $stashEntry) {
          throw "Failed to create a stash entry automatically."
        }

        $script:AutoStashRef = ($stashEntry -split '::')[0]
        Write-Host "`n✅  Changes stashed as $($script:AutoStashRef). They will be restored after the merge completes." -ForegroundColor Green
        return
      }
      'C' {
        git add -A | Out-Host
        if (-not (git status --porcelain)) {
          Write-Host "`nNo changes left to commit after staging. Returning to the menu." -ForegroundColor Yellow
          continue
        }

        $commitMessage = (Read-Host "Enter commit message").Trim()
        if (-not $commitMessage) {
          $commitMessage = "merge-pr: save local changes $(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
        }

        git commit -m $commitMessage | Out-Host

        if (git status --porcelain) {
          Write-Host "`nSome changes are still present after committing. Review them before continuing." -ForegroundColor Yellow
          continue
        }
        Write-Host "`n✅  Changes committed. Continuing with a clean working tree." -ForegroundColor Green
        return
      }
      'D' {
        $confirm = (Read-Host "Type DELETE to discard ALL local changes").Trim()
        if ($confirm -ne "DELETE") {
          Write-Host "`nDiscard cancelled. Returning to the menu." -ForegroundColor Yellow
          continue
        }
        git reset --hard | Out-Host
        git clean -fd | Out-Host
        if (git status --porcelain) {
          Write-Host "`nSome changes remain after cleanup. Returning to the menu." -ForegroundColor Yellow
          continue
        }
        Write-Host "`n✅  Local changes discarded. Continuing with a clean working tree." -ForegroundColor Green
        return
      }
      'I' {
        Write-Host "`nContinuing with local changes in place. If Git cannot switch branches or merge, the script will stop." -ForegroundColor Yellow
        return
      }
      'A' {
        throw "Merge aborted by user because local changes need attention."
      }
      default {
        Write-Host "`nInput not recognized. Please enter S, C, D, I, or A." -ForegroundColor Yellow
      }
    }
  }
}

function Restore-AutoStash {
  param([switch]$OnError)

  if (-not $script:AutoStashRef) { return }

  $reason = if ($OnError) { 'after an error' } else { 'after merge completion' }
  Write-Host "`nRestoring stashed changes ($($script:AutoStashRef)) $reason..." -ForegroundColor Cyan

  try {
    git stash pop $script:AutoStashRef | Out-Host
    $script:AutoStashRef = $null
  }
  catch {
    Write-Host "`n⚠️  Failed to auto-apply $($script:AutoStashRef). Please apply it manually when ready:" -ForegroundColor Yellow
    Write-Host "   git stash pop $($script:AutoStashRef)" -ForegroundColor Yellow
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

  Restore-AutoStash

  Write-Host "`n✅ Merge complete. main is up to date and builds clean." -ForegroundColor Green
  Write-Host "   You can now run:  npm run dev" -ForegroundColor DarkGray
}
catch {
  Restore-AutoStash -OnError

  Write-Host "`n❌ Error: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   If you were dropped into an editor (Vim), press Esc then :wq Enter to continue."
  exit 1
}
