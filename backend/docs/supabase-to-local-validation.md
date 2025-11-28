# Supabase → local PostgreSQL validation checklist

Use this runbook to confirm every Supabase table you exported now exists and matches in the local `toofunny` database. It also shows where to place future dumps/seeds so merge scripts capture database artifacts alongside code changes.

## 1) Pre-flight
- Local database is running and reachable (see `docs/local-postgres-source-of-truth.md`).
- You can reach Supabase with a service-role connection string (for `pg_dump`) and the PostgREST URL (for the app envs).
- PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) are on `PATH`.

## 2) Export from Supabase
- Preferred: run the orchestrator and take the recommended exports:
  ```powershell
  cd C:\Apps\TooFunnyProductions
  node scripts\migrate-supabase.js
  ```
  Accept the prompts to dump schema + data into `backend\docs\schema` and `backend\docs\data`.
- Manual alternative (per-table):
  ```powershell
  $env:PGPASSWORD="<supabase-password>"
  $supabaseUrl = "postgresql://<user>@<host>:<port>/<database>?sslmode=require"

  pg_dump --data-only --no-owner --no-privileges --table public.settings_draft \
      --file "backend/docs/data/001_settings_draft.sql" $supabaseUrl
  ```
  Repeat for `settings_public`, `settings_lock`, `settings_versions`, `settings_deployments`, `admin_actions`, and `contact_responses`.

> Commit any `.sql` dump you intend to keep so merge scripts and reviewers can see the DB artifacts.

## 3) Restore into local
- Apply schema + helper DDLs if needed (see `backend/docs/local-postgres-migration-guide.md`).
- Load the dumps in order:
  ```powershell
  $env:PGPASSWORD="<local-password>"
  $localUrl = "postgresql://postgres:<local-password>@localhost:5432/toofunny"
  Get-ChildItem backend/docs/data/*.sql | Sort-Object Name | ForEach-Object {
    psql --dbname $localUrl --file $_.FullName
  }
  ```
- If you exported a custom-format `.backup`, restore it with `pg_restore --clean --no-owner --no-privileges -1 ...`.

## 4) Compare Supabase vs local (row counts + hashes)
Use the FDW comparison script to catch any drift:
```powershell
$env:PGPASSWORD="<local-password>"
psql --set ON_ERROR_STOP=on --dbname "postgresql://postgres:<local-password>@localhost:5432/toofunny" \
     --file backend/docs/tests/002_compare_supabase_fdw.sql
```
Inspect `row_diff`/`DIFFERS` columns and the optional `EXCEPT` queries. Resolve differences, rerun until clean, then execute the teardown statements at the bottom of the script.

## 5) App/env cutover check
- Update `backend/.env` and `frontend/.env` so `SUPABASE_URL`/`VITE_SUPABASE_URL` point at the PostgREST endpoint for the local database (e.g., Supabase CLI on `http://127.0.0.1:54321`).
- Swap in the local service/anon keys. Remove the hosted `.supabase.co` values after verification.

## 6) Ongoing merges that include DB content
- Place schema exports under `backend/docs/schema/` and data dumps under `backend/docs/data/` so Git captures them.
- When using `merge-pr*.ps1`, these tracked `.sql`/.backup files ride along with code changes automatically.
- Add a short note in PRs describing any new dump so reviewers know it reflects Supabase state on a given date.
- After merging, re-run `node scripts\migrate-supabase.js` (or the PowerShell backup/restore helper) locally to stay in sync with the committed artifacts.
