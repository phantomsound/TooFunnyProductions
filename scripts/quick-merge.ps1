<#
  quick-merge.ps1
  Copy/paste-friendly helper to merge a remote branch into main using -X theirs.

  Usage examples:
    pwsh -File scripts/quick-merge.ps1 -Branch codex/some-branch
    ./scripts/quick-merge.ps1               # uses default branch placeholder (will fail until you set -Branch)
#>

param(
  [string] $Branch = "codex/your-branch"
)

$ErrorActionPreference = 'Stop'

if ($Branch -eq "codex/your-branch") {
  throw "Set -Branch to the remote branch you want to merge (e.g., -Branch codex/feature)."
}

if (-not (Test-Path ".git")) { throw "Run from the repo root (missing .git)." }

$dirty = git status --porcelain
if ($dirty) { throw "Working tree is dirty. Commit or stash before merging.`n$dirty" }

git fetch origin $Branch
if (-not (git branch --list $Branch)) {
  git switch -c $Branch --track origin/$Branch | Out-Host
} else {
  git switch $Branch | Out-Host
  git pull | Out-Host
}

git switch main | Out-Host
git pull origin main | Out-Host
git merge --no-edit -X theirs origin/$Branch | Out-Host
git push origin main | Out-Host

Write-Host "Merge complete. main now contains origin/$Branch." -ForegroundColor Green
