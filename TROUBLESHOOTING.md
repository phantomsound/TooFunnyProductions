# Troubleshooting Checklist

Use this guide if local commands such as `npm run dev` or `npm run setup` report that the script is missing or if recent
changes from GitHub are not appearing on disk.

## 1. Verify you have the latest commit

```powershell
cd C:\Apps\TooFunnyProductions
git fetch origin
# WARNING: this discards local edits
git reset --hard origin/main
```

`git reset --hard` aligns your working tree with the `origin/main` branch, removing any partial edits that may block the
pull. If you have edits you want to keep, run `git stash --include-untracked` before the reset and later restore them
with `git stash pop`.

## Quick copy/paste merge for a branch

If you just need to fast-forward `origin/main` with a feature branch (for example while testing a Codex PR), paste the
block below into PowerShell from the repo root. Replace `codex/your-branch` with the branch you want to merge. The
commands abort early if your working tree is dirty.

```powershell
$branch = "codex/your-branch"  # set the branch you want to merge

if (git status --porcelain) { throw "Clean or stash your changes first." }

git fetch origin $branch
if (-not (git branch --list $branch)) {
  git switch -c $branch --track origin/$branch
} else {
  git switch $branch
  git pull
}

git switch main
git pull origin main
git merge --no-edit -X theirs origin/$branch
git push origin main
```

This mirrors the defaults used by `merge-pr-v2.ps1` (clean working tree, `-X theirs` for fewer conflicts) without
requiring the helper script itself.

## 2. Check the helper scripts

From the repo root, run:

```powershell
npm run doctor
```

This diagnostic confirms the required npm scripts exist, reports any uncommitted files, reminds you to copy the
environment templates, and inspects `frontend/src/pages/admin/AdminSettingsGeneral.tsx` for common merge leftovers
that trigger Vite build failures.

If `npm run doctor` itself fails with `Missing script`, open `package.json` and confirm the `scripts` section includes
`setup`, `dev`, `dev:backend`, `dev:frontend`, `build`, `start`, `start:api`, and `doctor`. If not, repeat step 1 to
synchronize with `origin/main`.

If the doctor script reports stray `package-lock.json` files inside `backend/` or `frontend/`, they can be safely removed with
`git clean -fd` (they are intentionally excluded from version control because each workspace is managed via the root `package-lock.json`).

### Still seeing `Unexpected ":"` errors from Vite?

That message indicates one of the admin settings files contains leftover TypeScript syntax from an outdated merge (for example,
`session_timeout_minutes?: number;`). The fix is to refresh your checkout so the current TypeScript version of
`frontend/src/pages/admin/AdminSettingsGeneral.tsx` is restored.

```powershell
git status               # make sure nothing you need is listed under "Changes not staged for commit"
git fetch origin
git reset --hard origin/main
git clean -fd            # removes stray package-locks or generated files
npm run setup
```

After the reset finishes, re-run `npm run dev`. The TypeScript file in `origin/main` compiles cleanly; if the error persists,
verify that your editor is not restoring old content from a stash or backup plugin.

## 3. Recreate the environment files

```powershell
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env  # optional; only needed to override Vite defaults
```

Fill in `backend/.env` with your Supabase project URL, service role key, session secret, and Google OAuth credentials.

## 4. Install dependencies and launch the stack

```powershell
npm run setup
npm run dev
```

`npm run setup` installs backend and frontend dependencies using workspace-aware `npm install` calls. `npm run dev`
spawns both the Express API (http://localhost:5000) and the Vite frontend (http://localhost:5173) with a single command.

If `npm run dev` still fails, rerun `npm run doctor` and double-check `git status` for stray edits or merges that need to
be resolved.

---

Need more help? Drop the exact error text and the output of `npm run doctor` in the support thread so we can spot the
issue quickly.
