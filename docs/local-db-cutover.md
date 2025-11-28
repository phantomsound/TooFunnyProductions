# Local PostgreSQL cutover guide (dev)

This checklist walks every part of the stack so the app runs purely against your local PostgreSQL instance (`toofunny` on `127.0.0.1:5432`) instead of the hosted Supabase project.

## 1) Environment variables
- Backend: use `DATABASE_URL` or the discrete `DB_*` variables that point at `postgresql://postgres:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable`.
- Frontend: **leave Supabase envs empty**. The browser should never talk directly to Supabase; it goes through the backend.
- Supabase-specific keys (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) should be omitted/blank for local development.

## 2) Database content
- Ensure your local instance already has the schema/data restored from Supabase (you mentioned it is). If you ever need to reseed, use the SQL files under `backend/docs/schema/` and `backend/docs/data/`.
- Confirm connectivity with `psql "postgresql://postgres:<PASSWORD>@127.0.0.1:5432/toofunny" -c "select now();"`.

## 3) Backend configuration
- Copy `backend/.env.example` to `backend/.env` and fill in the DB credentials + `SESSION_SECRET`.
- Remove/leave blank any Supabase variables in `.env` so the backend does not attempt to use the hosted project.
- Restart the backend after updating envs (`npm install` if dependencies changed, then `npm run dev` or `npm start` from `backend/`).

## 4) Frontend configuration
- Copy `frontend/.env.example` to `frontend/.env`.
- Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` empty. The frontend uses the backend API (e.g., `/api/settings`, `/api/contact`) and should not hold DB credentials.
- Run `npm install` in `frontend/` if you haven’t already, then `npm run dev` to start Vite on port 5173.

## 5) Manual verification checklist
- **Settings**: Visit the site and confirm the homepage/about/services content loads. The backend should read from your local `settings_*` tables; if Supabase vars are blank, it will fall back to the local JSON files under `backend/data/`.
- **Contact form**: Submit a test message. With Supabase disabled, the backend stores contact responses in `backend/data/contact-responses.json` and logs delivery status. (If SMTP is configured, it will also attempt to send.)
- **Admin**: Sign in with the admin allowlist you configure via `ALLOWLIST_EMAILS` or `backend/data/admin-allowlist.json`. Admin features that depended on Supabase (e.g., audit log, settings snapshots) require the local DB schema restored; otherwise they operate in file-backed fallback mode.
- **Storage**: Media upload/list routes still use Supabase Storage. If you want entirely local storage, wire these routes to a local object store or filesystem and clear the Supabase storage envs.

## 6) What to edit next if something still points at Supabase
- Search for `SUPABASE` in the codebase (both backend and frontend). Any remaining references indicate a feature still depending on the hosted project (e.g., storage, audit log). Replace those with local equivalents or leave the env blank to disable.
- Update `backend/docs/local-postgres-migration-guide.md` (if applicable) after you’ve fully cut over.

## 7) Secrets
- Never commit your real password or service keys. Keep `.env` local (already ignored by git).
