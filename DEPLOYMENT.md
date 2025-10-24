# Too Funny Productions — Deployment & Operations Guide

This guide walks through preparing the environment variables, running the app during development, and hosting the combined frontend + backend service on your own machine or server.

## 1. Environment configuration

Create `backend/.env` with the required secrets:

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
SESSION_SECRET=generate-a-long-random-string
ALLOWLIST_EMAILS=admin@example.com,second-admin@example.com
FRONTEND_URL=https://toofunnyproductions.com
CORS_ORIGIN=https://toofunnyproductions.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=/api/auth/google/callback
```

> **Tip:** Use the SQL statements in `backend/docs/settings-columns.sql` inside Supabase’s SQL editor once so every new column used by the admin UI exists in both `settings_draft` and `settings_public`.

For the frontend, copy `frontend/.env.example` to `frontend/.env` when you want to override the API location in development:

```
VITE_API_URL=http://localhost:5000
```

When you build for production the React app will fall back to the same origin that served it, so no extra configuration is needed.

## 2. Install dependencies

From the repo root run:

```
npm run setup
```

That installs packages in both `backend/` and `frontend/` workspaces.

## 3. Development workflow

```
npm run dev
```

This starts the Express API on port `5000` and the Vite dev server on `5173` simultaneously. The script watches for Ctrl+C and shuts both processes down cleanly.

You can still start the layers separately if you prefer:

```
npm run dev:backend
npm run dev:frontend
```

## 4. Build & serve the production bundle

1. Build the React app:
   ```
   npm run build
   ```
   The output lands in `frontend/dist/`.

2. Start the backend in production mode, which will automatically serve any files found in `frontend/dist` under the same domain:
   ```
   npm run start
   ```

   The server listens on `PORT` (defaults to `5000`). Visit `http://localhost:5000` or your Cloudflare domain to load the SPA.

> The backend detects `frontend/dist` automatically; if you prefer a different location set `FRONTEND_DIST=/absolute/path/to/build` in the environment.

## 5. Keeping the service running

To keep the service alive on your PC you can:

- Use a process manager like [PM2](https://pm2.keymetrics.io/):
  ```
  pm2 start npm --name toofunny -- run start
  pm2 save
  ```

- Or create a `systemd` unit (Linux):
  ```ini
  [Unit]
  Description=Too Funny Productions Admin
  After=network.target

  [Service]
  WorkingDirectory=/path/to/TooFunnyProductions
  ExecStart=/usr/bin/npm run start
  Restart=always
  Environment=PORT=5000
  Environment=FRONTEND_URL=https://toofunnyproductions.com
  Environment=...other vars...

  [Install]
  WantedBy=multi-user.target
  ```

## 6. Cloudflare & domain notes

1. Point your domain’s A record to your PC’s public IP (or use Cloudflare Tunnel if you don’t want to expose your IP).
2. Make sure the backend listens on the same origin (`FRONTEND_URL` and `CORS_ORIGIN` above) so cookies and OAuth callbacks succeed.
3. Update your Google OAuth client to allow the callback URL for every host that should reach the admin panel. Leaving
   `GOOGLE_CALLBACK_URL` as `/api/auth/google/callback` lets the server auto-detect the current hostname (both locally and in
   production), but each resulting full URL still needs to be listed in the Google Cloud Console. If you override this setting
   with a full URL make sure it uses your public domain—do not leave it pointing at `http://localhost` when deploying.

### Mapping Cloudflare Tunnel hostnames

The `setup-services.ps1` installer now looks at `cloudflared.yml` and calls `cloudflared tunnel route dns` for every `hostname` entry it finds. This automatically creates (or updates) the CNAME records for your tunnel. To take advantage of it:

1. Run `cloudflared login` once on the machine so the CLI has permission to manage DNS for your zone.
2. Edit `cloudflared.yml` with the public hostnames you want to serve through the tunnel (each under an `ingress` entry). Hostnames that point to other services on the same machine (like the existing KBBG site on port `8080`) can stay in the file—the script only manages the DNS CNAMEs and leaves the `service:` targets untouched.
3. When you are ready (for a fresh install or to pick up changes) run `./setup-services.ps1` from the repo root. The script will install missing Node.js dependencies, build the production frontend if `frontend/dist` is absent, stop the `TFPService` web process, reinstall it so it runs directly on `node.exe` (no nested `npm` shells required), ensure the Cloudflare tunnel runs under the `MikoCFTunnel` service (cleaning up the legacy `TFPService-Tunnel` name if it still exists), read the `tunnel:` name from `cloudflared.yml`, and then reconcile the DNS records through the Cloudflare API.
4. If a hostname fails to map (for example because it already exists or because additional permissions are required) the script will emit a warning. In that case re-run the command manually with the same tunnel name you set in `cloudflared.yml`: `cloudflared tunnel route dns <tunnel-name> your.hostname.example`.

> The DNS automation is idempotent: existing records pointing at the tunnel are left in place, and any stale `toofunnyproductions.com` CNAMEs that no longer appear in `cloudflared.yml` are removed automatically, so you can rerun the installer whenever you change hostnames.

Once the admin settings are saved in Draft mode you can preview via the “Preview Draft” button and publish when ready. The General Settings page now shows inline success/error feedback and requires you to switch to Draft before saving, keeping the workflow predictable.
