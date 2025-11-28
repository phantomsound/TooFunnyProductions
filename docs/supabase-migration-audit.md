# Supabase → Local Postgres audit (2025-XX-XX)

This note summarizes where Supabase/PostgREST is still wired into the project and how to finish the cutover to the local database.
Use it as a checklist while verifying the migration.

## Environment + deployment
- `.env` variables still use `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` as the PostgREST connection pair. Make sure they point at your local PostgREST endpoint (for example `http://127.0.0.1:54321`) instead of the hosted `*.supabase.co` domain. The `DB_FRIENDLY_NAME` override will drive the admin "friendly name" badge if you want something other than the auto-detected hostname.
- `DEPLOYMENT.md` already documents swapping these values after the migration; double-check the secrets in each environment and remove the hosted URL so the backend cannot silently fall back to Supabase.

## Backend coupling
- `backend/lib/databaseStatus.js` still uses `@supabase/supabase-js` to probe `settings_public` for connectivity and to populate the admin dashboard status card. It treats any `*.supabase.co` hostname as "Supabase" and `localhost/127.0.0.1/*.local` as "local". Pointing `SUPABASE_URL` at your local PostgREST keeps this working without code changes.
- `backend/lib/settingsLoader.js` pulls settings from `settings_draft`/`settings_public` via Supabase first, then falls back to `data/settings.local.json` or the baked-in `data/settings.json`. Keep the Supabase env vars set to the local endpoint so the primary fetch stays inside Postgres.
- `backend/lib/audit.js` and `backend/lib/contactResponses.js` write to Supabase tables by default and only fall back to JSON files if the env vars are missing. They do not need code changes if the local PostgREST URL + service key are configured; otherwise they will silently create local files.
- `backend/routes/storage.js` still fronts Supabase Storage for media operations (list, upload, copy, delete). It expects `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `SUPABASE_STORAGE_BUCKET` (defaults to `media`) to be valid against your local Supabase-compatible stack.

## Frontend coupling
- `frontend/src/lib/supabaseClient.ts` creates a client with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Update the Vite env file to point at the local PostgREST endpoint and anon key so the public pages sign requests against your local stack.
- `frontend/src/utils/media.ts` detects Supabase Storage URLs (including legacy `/api/storage/objects/public/...`) and proxies them through `/api/storage/proxy`. Once `VITE_SUPABASE_URL` is local, newly picked media will target the local bucket; existing hard-coded Supabase URLs will continue to be proxied until you rewrite them.
- The admin Database workspace (`frontend/src/pages/admin/AdminDatabaseWorkspace.tsx`) surfaces the backend status. When the env vars are pointed locally, the badge should show **MikoDB** and connectivity should be green.

## Scripts + validation
- `scripts/migrate-supabase.js` remains the primary export/import pipeline from hosted Supabase into local Postgres. Run `npm run migrate:supabase` to re-export schemas/data, then repoint env vars.
- Use `backend/docs/tests/002_compare_supabase_fdw.sql` to compare local tables against the hosted project via FDW. It already includes a check that searches JSON payloads for `supabase.(co|in|net)` so you can find lingering URLs before shutting off Supabase.
- The broader migration guide lives in `docs/local-postgres-source-of-truth.md`; follow the operational checklist there after updating the env files.

## Cleaning up lingering Supabase URLs in content
If any stored settings/media still reference `*.supabase.co`, you can bulk-rewrite them instead of re-picking every item by hand:

1. **Run the automated rewrite**
   - Point your SQL client at your **local** database (you confirmed Postgres is listening on 5432, so your connection string should use that port unless your PostgREST proxy runs elsewhere).
   - Set `replacement_host` to the same PostgREST base URL you used for `SUPABASE_URL` / `VITE_SUPABASE_URL` after the cutover. Examples:
     - Supabase local stack default PostgREST: `http://127.0.0.1:54321`
     - Plain PostgREST served directly on Postgres port 5432: `http://127.0.0.1:5432`
     - If unsure, open your env file and copy `SUPABASE_URL`/`VITE_SUPABASE_URL` exactly.
   - Run the script in one of the following ways (replace `<host>` with your URL):
     - **psql one-liner**: `psql -d <db> -c "SET replacement_host = '<host>';" -f backend/docs/tests/003_rewrite_supabase_urls.sql`
     - **psql interactive**: `SET replacement_host = '<host>';` then `\i backend/docs/tests/003_rewrite_supabase_urls.sql`
     - **pgAdmin Query Tool**: run `SET replacement_host = '<host>';` then execute the script
     - **PowerShell two-liner**:
       - `psql -d <db> -c "SET replacement_host = '<host>';"`
       - `psql -d <db> -f backend/docs/tests/003_rewrite_supabase_urls.sql`
   The script walks JSONB columns in the settings/admin tables and rewrites any Supabase hostnames to the replacement host, printing how many rows changed per table/column.

2. **Find any remaining offenders**
   ```sql
   -- Look for Supabase URLs inside JSON payloads in settings versions
   SELECT id, jsonb_path_query(payload::jsonb, '$.** ? (@ like_regex "supabase\\.(co|in|net)")') AS offending
   FROM settings_versions
   WHERE jsonb_path_exists(payload::jsonb, '$.** ? (@ like_regex "supabase\\.(co|in|net)")');
   ```
   (This mirrors the validation block in `backend/docs/tests/002_compare_supabase_fdw.sql`.)

3. **Re-pick only what is left**
   After the rewrite, open the admin settings/media manager and re-select any items that still point at Supabase. Saving them will persist through the local PostgREST endpoint because the env vars now target your local stack.

## What to do now
- Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` to your **local** PostgREST and anon key values across backend + frontend.
- Run the FDW comparison script to confirm row counts/hashes and to catch any Supabase URLs hiding in JSON payloads.
- Use the SQL snippet above (tuned to your columns) to bulk-rewrite remaining Supabase storage links; then spot-check via the admin UI and media manager.
