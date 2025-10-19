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

## 2. Check the helper scripts

From the repo root, run:

```powershell
npm run doctor
```

This diagnostic confirms the required npm scripts exist, reports any uncommitted files, and reminds you to copy the
environment templates.

If `npm run doctor` itself fails with `Missing script`, open `package.json` and confirm the `scripts` section includes
`setup`, `dev`, `dev:backend`, `dev:frontend`, `build`, `start`, `start:api`, and `doctor`. If not, repeat step 1 to
synchronize with `origin/main`.

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
