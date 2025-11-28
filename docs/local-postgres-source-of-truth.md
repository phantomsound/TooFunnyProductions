# Too Funny Productions — Local Postgres Source of Truth

This guide consolidates how to point the app at **local PostgreSQL** after migrating off Supabase, plus how to back up and restore the database.

## Connection details

**Primary (local)**
```
postgresql://postgres:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable
```

If you created a dedicated app role:
```
postgresql://tfp_owner:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable
```

**Key/Value form**
```
host=127.0.0.1 port=5432 dbname=toofunny user=postgres password=<PASSWORD> sslmode=disable
```

## App snippets

**Node (pg)**
```js
// .env
DATABASE_URL=postgresql://tfp_owner:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable

// db.js
const { Pool } = require('pg');
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

**Prisma**
```dotenv
DATABASE_URL="postgresql://tfp_owner:<PASSWORD>@127.0.0.1:5432/toofunny?schema=public&sslmode=disable"
```
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Python (SQLAlchemy 2.x)**
```python
SQLALCHEMY_DATABASE_URI = "postgresql+psycopg2://tfp_owner:<PASSWORD>@127.0.0.1:5432/toofunny?sslmode=disable"
```

**Django**
```python
DATABASES = {
  "default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": "toofunny",
    "USER": "tfp_owner",
    "PASSWORD": "<PASSWORD>",
    "HOST": "127.0.0.1",
    "PORT": "5432",
    "OPTIONS": {"sslmode": "disable"},
  }
}
```

## Backup / Restore helper (PowerShell GUI)

Use `backend/docs/TFP-DB-BackupRestore.ps1` (place it anywhere convenient):
- **Backup** → choose a save location → creates a custom-format file (`.backup`) via `pg_dump -Fc`.
- **Restore** → select a `.backup`/`.bak`/`.dump` (uses `pg_restore --clean`), or a `.sql` (uses `psql -f`).

**Setup**
1. Install PostgreSQL client tools (for example `C:\Program Files\PostgreSQL\18\bin`).
2. Put the script next to your project or any tools folder.
3. Run it: right-click → *Run with PowerShell* (or in a PowerShell window: `./TFP-DB-BackupRestore.ps1`).

**Notes**
- The tool prompts for **Host / Port / DB / User / Password / pg bin path** and remembers them in `TFP-DB-BackupRestore.config.json` next to the script.
- Password is passed via the `PGPASSWORD` env var only for the child process and then cleared.
- For restores, if you pick `.sql`, it uses `psql -f`. For `.backup` it uses `pg_restore --clean --no-owner --no-privileges -1`.

## Operational checklist

- [ ] Local DB `toofunny` is running and reachable.
- [ ] App `.env` points to local Postgres `DATABASE_URL` (backend and frontend Supabase URLs should now target the PostgREST endpoint that fronts this database).
- [ ] After any bulk data import, run `ANALYZE;` to refresh planner stats.
- [ ] Run the Supabase → local validation checklist (`backend/docs/supabase-to-local-validation.md`) to confirm counts/hashes match and env files are pointed at the local PostgREST endpoint.
- [ ] (Optional during dev) if RLS policies block you, grant temporary bypass:
  ```sql
  ALTER ROLE tfp_owner BYPASSRLS;
  ```
  Remove before production.

## Quick CLI (no GUI)

**Backup**
```powershell
$env:Path = "C:\Program Files\PostgreSQL\18\bin;$env:Path"
pg_dump -h 127.0.0.1 -U postgres -d toofunny -Fc -f "C:\backups\toofunny-$(Get-Date -f yyyyMMdd_HHmmss).backup"
```

**Restore**
```powershell
pg_restore --clean --no-owner --no-privileges -h 127.0.0.1 -U postgres -d toofunny -1 "C:\backups\toofunny-20251125_213000.backup"
```

## Where this fits in the migration

After exporting from Supabase with `npm run migrate:supabase` (see `scripts/migrate-supabase.js` and `backend/docs/local-postgres-migration-guide.md`), point the backend/ frontend env files at the PostgREST endpoint that fronts this local database. Use the validation SQL in `backend/docs/tests/002_compare_supabase_fdw.sql` to confirm row counts, hashes, and lingering Supabase URLs before decommissioning the hosted project.
