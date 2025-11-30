# Local PostgreSQL cutover guide (dev)

This checklist walks every part of the stack so the app runs purely against your local PostgreSQL instance (`toofunny` on `127.0.0.1:5432`) instead of the hosted Supabase project.

## 1) Environment variables
- Backend: use `DATABASE_URL` or the discrete `DB_*` variables that point at `postgresql://postgres:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable`.
- Frontend: **leave Supabase envs empty**. The browser should never talk directly to Supabase; it goes through the backend.
- Supabase-specific keys (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) should be omitted/blank for local development.
- Quick check: `backend/.env.example` already shows the local Postgres defaults with blank Supabase values; copy it to `backend/.env` and only fill in DB creds + secrets. `frontend/.env.example` only contains `VITE_API_URL` plus the two Supabase placeholders—keep those placeholders empty so Vite only calls the backend.

## 2) Database content
- Ensure your local instance already has the schema/data restored from Supabase (you mentioned it is). If you ever need to reseed, use the SQL files under `backend/docs/schema/` and `backend/docs/data/`.
- Confirm connectivity with `psql "postgresql://postgres:<PASSWORD>@127.0.0.1:5432/toofunny" -c "select now();"`.
- Optional comparison script (run once to sanity-check against Supabase before the cutover):
  ```bash
  # Set both URLs, then run the same row-count query against each
  export LOCAL_URL="postgresql://postgres:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable"
  export SUPA_URL="postgresql://postgres:<PASSWORD>@<SUPABASE_HOST>:5432/postgres?sslmode=require"

  cat > /tmp/tfp-rowcounts.sql <<'SQL'
  -- Adjust the table list if you add new modules
  SELECT 'settings_versions' AS table_name, count(*) AS rows FROM public.settings_versions
  UNION ALL
  SELECT 'settings_snapshots', count(*) FROM public.settings_snapshots
  UNION ALL
  SELECT 'settings_deployments', count(*) FROM public.settings_deployments
  UNION ALL
  SELECT 'audit_log_entries', count(*) FROM public.audit_log_entries
  UNION ALL
  SELECT 'contact_responses', count(*) FROM public.contact_responses
  ORDER BY table_name;
  SQL

  echo "Local:" && psql "$LOCAL_URL" -f /tmp/tfp-rowcounts.sql
  echo "Supabase:" && psql "$SUPA_URL" -f /tmp/tfp-rowcounts.sql
  ```
  The output gives a quick confidence check that high-signal tables (settings, audit log, contact responses) match before you retire Supabase.

## 3) Backend configuration
- Copy `backend/.env.example` to `backend/.env` and fill in the DB credentials + `SESSION_SECRET`.
- Remove/leave blank any Supabase variables in `.env` so the backend does not attempt to use the hosted project.
- Restart the backend after updating envs (`npm install` if dependencies changed, then `npm run dev` or `npm start` from `backend/`).
- Your merge/restart script is enough; just make sure it reloads after `.env` changes so the new `DATABASE_URL` is picked up.

## 4) Frontend configuration
- Copy `frontend/.env.example` to `frontend/.env`.
- Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` empty. The frontend uses the backend API (e.g., `/api/settings`, `/api/contact`) and should not hold DB credentials.
- Run `npm install` in `frontend/` if you haven’t already, then `npm run dev` to start Vite on port 5173.
- Only `VITE_API_URL` needs a value for local dev (`http://localhost:5000`). Leaving the Supabase fields blank is intentional and expected.

## 5) Manual verification checklist
- **Settings**: Visit the site and confirm the homepage/about/services content loads. The backend should read from your local `settings_*` tables; if Supabase vars are blank, it will fall back to the local JSON files under `backend/data/`.
- **Contact form**: Submit a test message. With Supabase disabled, the backend stores contact responses in `backend/data/contact-responses.json` and logs delivery status. (If SMTP is configured, it will also attempt to send.)
- **Admin**: Sign in with the admin allowlist you configure via `ALLOWLIST_EMAILS` or `backend/data/admin-allowlist.json`. Admin features that depended on Supabase (e.g., audit log, settings snapshots) require the local DB schema restored; otherwise they operate in file-backed fallback mode.
- **Storage**: Media upload/list routes still use Supabase Storage. If you want entirely local storage, wire these routes to a local object store or filesystem and clear the Supabase storage envs.
- Admin validation tip: after logging in with your allowlisted account (e.g., `kmiko28@gmail.com`), open the admin dashboard and ensure the settings modules load without Supabase creds. That same area can become a future “status” view—show the active DB URL, storage backend, and recent audit-log counts—once we wire it to the local Postgres metrics.

## 6) What to edit next if something still points at Supabase
- Search for `SUPABASE` in the codebase (both backend and frontend). Any remaining references indicate a feature still depending on the hosted project (e.g., storage, audit log). Replace those with local equivalents or leave the env blank to disable.
- Update `backend/docs/local-postgres-migration-guide.md` (if applicable) after you’ve fully cut over.

## 7) Secrets
- Never commit your real password or service keys. Keep `.env` local (already ignored by git).

## 8) Admin database workspace troubleshooting
If the Admin → Database workspace shows **Configured but unreachable**, work through this checklist against your local PostgREST/Supabase stack:

- **Ensure env vars point locally**: In `backend/.env`, set `SUPABASE_URL` to your local PostgREST endpoint (e.g., `http://127.0.0.1:54321` or whatever port your stack exposes) and keep `SUPABASE_SERVICE_KEY` to the local service-role key. Restart the backend after edits.
- **Mind the port mismatch**: PostgREST listens on `54321` while PostgreSQL speaks on `5432`. Point `SUPABASE_URL` at `54321` and keep your `DATABASE_URL`/`DB_PORT` on `5432` so the backend talks the right protocol to each service.
- **Probe the endpoint directly**: From the backend host, run `curl -i <SUPABASE_URL>` and confirm you get an HTTP response instead of a connection error. If the port is wrong or the service isn’t running, the admin card will stay red.
- **Service key matches the endpoint**: A mismatched key returns 401/403 from PostgREST and appears as “Supabase/PostgREST error” in the warning list. Regenerate the local service-role key if needed and update `SUPABASE_SERVICE_KEY`.
- **Local hostnames auto-label as MikoDB**: If the badge still says **Supabase**, you’re probably still pointing at the hosted domain. Swap the URL to the local host to keep reads/writes inside your local database.
- **Fallback mode**: With Supabase envs blank, the backend falls back to JSON files for settings/audit/contact data. That’s fine for smoke tests but won’t exercise your migrated Postgres schema—keep the envs populated with the local values to validate the cutover.
