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
$script:AutoStashRef = $null

function Ensure-AtRepoRoot {
  if (-not (Test-Path ".git")) { throw "Run from repo root ('.git' required). Current: $(Get-Location)" }
}

function Assert-NoConflictMarkers {
  # Catch unresolved merge markers early so PowerShell does not choke on '<<<<<<<'
  $markers = Get-Content $PSCommandPath | Select-String '^(<<<<<<<|=======|>>>>>>>)'
  if ($markers) {
    $lines = ($markers | Select-Object -First 3 | ForEach-Object { "  line $($_.LineNumber): $($_.Line.Trim())" }) -join "`n"
    throw "merge-pr-v2.ps1 still has merge conflict markers. Resolve the conflicts and re-run.`n$lines"
  }
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
          $customMessage = "merge-pr-v2 auto-stash $(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
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
          $commitMessage = "merge-pr-v2: save local changes $(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
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
  Assert-NoConflictMarkers
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

  Restore-AutoStash

  Write-Host "`n[Done] main is up to date and builds clean." -ForegroundColor Green
  Write-Host "   You can run: npm run dev" -ForegroundColor DarkGray
  if (-not $DryRun) { Show-PostMergeTips }
}
catch {
  Restore-AutoStash -OnError
  Write-Host "`n[Error] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   If an editor opened, press Esc then :wq Enter to continue."
  exit 1
}
finally {
  AutoUnstash-ThisScript
}
