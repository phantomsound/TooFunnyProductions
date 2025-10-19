# Too Funny Productions Admin System

This repo contains the Too Funny Productions admin dashboard (React + Vite + Tailwind) and the Express API that reads/writes the Supabase settings tables. The backend must run alongside the frontend so draft/live toggles, uploads, and publishing keep working.

## 🚀 Quick start (local machine)

1. Install dependencies for both workspaces:
   ```bash
   npm run setup
   ```
2. Create `backend/.env` with your Supabase URL/service key, session secret, Google OAuth values, and the domain you plan to use (see [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full list).
3. If you need to override the API URL in development, copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL=http://localhost:5000`.
4. Launch the stack:
   ```bash
   npm run dev
   ```
   The backend listens on <http://localhost:5000> and proxies `/api/*`, while Vite serves the admin UI on <http://localhost:5173>.

To build and serve everything from Express in one process:
```bash
npm run build      # builds frontend/dist
npm run start      # serves backend + static frontend from the same origin
```
The server auto-detects `frontend/dist` and responds to non-API routes with `index.html`, so the SPA loads from the same host that serves the API.

## 🌐 Why GitHub Pages will not work

GitHub Pages can only host static files. The admin panel depends on authenticated API routes (sessions, Supabase service key usage, media uploads) under `/api/*`, which require the Express server to be running. Because of that, deploying to `https://phantomsound.github.io/TooFunnyProductions/` would render the UI but every data action would fail with network errors. Host the bundled app from the Express server (on your PC or another machine) instead so the SPA and API share the same origin.

If you want a public marketing site on GitHub Pages, export a static copy from the public pages only and keep the admin tooling on a server with the API.

## 🛠️ Admin buttons & current status

The main admin shell wires up every top-level action:

- **View selector** — toggles between live and draft data by calling `setStage` in the settings context.
- **Save Draft** — persists the current draft payload via `save(...)`. Only enabled while viewing draft and when there are changes.
- **Pull Current Live** — copies live settings into draft by calling `pullLive()`.
- **Preview Draft** — opens the public site in a new tab with `?stage=draft` appended so you can browse the draft values.
- **Publish to Live** — triggers `publish()` which copies draft → live and reloads the live data.

Within **General Settings**:

- Brand/theme inputs keep local state and call `save(local)` when you click **Save General Settings**, ensuring draft mode is enforced and success/error feedback is shown.
- The **Footer Links** list dynamically adds/removes `{label,url}` rows and feeds them back to the draft payload.
- **Logo/Favicon uploaders** hit `/api/storage/upload`, store files in the Supabase `media` bucket, and surface the returned public URL so the setting is ready to save.

Tabs for About, Events, Media, Merch, and Contact currently render a “Coming soon” placeholder; wireframes/content for those pages can be implemented next.

## ✅ Health check

After the environment variables are populated, run:
```bash
npm run dev
```
Visit <http://localhost:5173/admin> to sign in with an allow-listed Google account. When you need to confirm the production bundle, run `npm run build --prefix frontend`; Vite should complete without errors (warnings about shared imports are expected when both static and dynamic imports exist).
