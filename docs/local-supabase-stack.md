# Local Supabase/PostgREST stack (Windows-focused)

Use this guide if you want the admin mode + storage features to behave like Supabase, but hosted locally. This is the recommended path when you are cutting over from Supabase Cloud and want the backend to keep using a PostgREST API.

## 1) Install the Supabase CLI (no repo changes required)
Pick one of the official install methods that best matches your environment:

- Supabase CLI: https://supabase.com/docs/guides/cli

> If you already have the CLI on your old machine, copy its version and install the same version here to reduce surprises.

## 2) Start the local Supabase stack
From the repo root:

```powershell
supabase start
```

This starts PostgREST (default `http://127.0.0.1:54321`) plus auth/storage services. Leave it running in its own terminal.

## 3) Wire the app to the local PostgREST endpoint
Update your `.env` files **without touching any unrelated local edits**:

**backend/.env**
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<local-service-role-key>
```

**frontend/.env**
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local-anon-key>
```

> If the backend runs on a different host, use the LAN IP instead of `127.0.0.1` (for example `http://192.168.1.211:54321`).

## 4) Confirm the endpoints are reachable
From the backend host:

```powershell
Invoke-WebRequest http://127.0.0.1:54321
```

Or use the repo helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-local-supabase.ps1
```

## 5) Cloudflare notes
- If Cloudflare is only used for the public website, **do not** set `SUPABASE_URL` to the Cloudflare URL.
- Only use a Cloudflare URL if it is explicitly proxying the local PostgREST endpoint.

## 6) Troubleshooting quick hits
- PostgREST listens on **54321**, Postgres listens on **5432**. Make sure the URL/port pair is correct.
- If admin mode still says **Configured but unreachable**, confirm `SUPABASE_SERVICE_KEY` matches the local stack’s JWT secret.
