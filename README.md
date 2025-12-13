# Too Funny Productions

This repo contains the Express backend and Vite React frontend for the Too Funny Productions site. Use the steps below to restore a working local copy.

## Quick start
1. Copy the environment templates:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env # optional
   ```
2. Fill in the required secrets in `backend/.env`:
   - Database connection or `DATABASE_URL`
   - `SESSION_SECRET`
   - Google OAuth client ID/secret
   - Supabase/PostgREST URL and service role key
   - Public backend URL (see the notes in the template)
3. Install dependencies and start both servers:
   ```bash
   npm run setup
   npm run dev
   ```

The API listens on port 5000 and the Vite dev server on port 5173. In production, build the frontend first so the backend can serve it:
```bash
npm run build
npm start
```

If you hit issues, run `npm run doctor` for a quick audit and review `TROUBLESHOOTING.md` for reset steps.
