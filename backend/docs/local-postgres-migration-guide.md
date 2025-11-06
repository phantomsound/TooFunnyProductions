# Local PostgreSQL Migration Guide

This guide outlines how to provision a 250 GB PostgreSQL instance on `H:\apps`, mirror your Supabase media manager schema, and prepare supporting scripts in `C:\Apps\TooFunnyProductions\backend\docs`.

## Fast lane: interactive migration helper

Run the orchestrator once `pg_dump`/`psql` are on your `PATH`:

```powershell
cd C:\Apps\TooFunnyProductions
node scripts\migrate-supabase.js
```

The script will:

1. Prompt for your Supabase and local PostgreSQL connection strings (reminding you about the default docs path under `backend\docs`).
2. Export the Supabase schema to `schema\supabase_schema.sql` and optionally create the local `toofunny_media` database.
3. Reapply `schema\supabase_schema.sql` plus the helper DDLs (`settings-columns.sql`, `schema\contact-responses.sql`, and `admin-actions.sql`).
4. Offer to export/import the recommended data tables (`settings_*`, `admin_actions`, `contact_responses`) in order.
5. Optionally run `fullChecker.sql` against both environments so you can diff structures and row counts.

If you prefer to execute commands manually—or need to customise the workflow beyond the prompts—follow the detailed steps below.

## 1. Install PostgreSQL with data directory on `H:\apps`
1. Download the Windows installer for PostgreSQL 15 (or higher) from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/).
2. Run the installer and choose **Custom** setup when prompted.
3. When asked for the data directory, set it to `H:\apps\pgsql\data`.
4. Supply the superuser password and note the default port (`5432`).
5. Allow the installer to register the Windows service.
6. After installation, open **Services** and confirm that the `postgresql-x64-15` service starts successfully.

### Ensure drive permissions
* In File Explorer, right-click `H:\apps`, open **Properties → Security**, and grant **Full control** to the Windows account that runs the PostgreSQL service (typically `NT SERVICE\postgresql-x64-15`).
* Click **Advanced → Enable inheritance** if permissions do not propagate to the `pgsql` subfolder.

## 2. Verify storage and performance capacity
1. In PowerShell, confirm free space: `Get-PSDrive -Name H`.
2. Reserve at least 250 GB for the PostgreSQL cluster plus headroom for growth (recommend ≥300 GB free).
3. Enable write caching on the external drive if available (Device Manager → Disk Drives → Properties → Policies).
4. Set up a backup routine for `H:\apps\pgsql\data` (e.g., Windows File History or third-party backup) to protect against external drive failure.

## 3. Capture Supabase schema
1. Install the PostgreSQL CLI tools if not included (select **Command Line Tools** during installation).
2. From a terminal, export the schema-only dump:
   ```powershell
   pg_dump --schema-only --no-owner --no-privileges \
       --dbname "postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=require" \
       --file "C:\Apps\TooFunnyProductions\backend\docs\schema\supabase_schema.sql"
   ```
3. Commit the exported file to version control (optional) or keep it in the docs folder for reference.

## 4. Recreate schema locally
1. Open **psql** (found under `Start → PostgreSQL 15 → SQL Shell`).
2. Connect to your local instance (host `localhost`, port `5432`, database `postgres`, user `postgres`).
3. Create a dedicated database:
   ```sql
   CREATE DATABASE toofunny_media OWNER postgres;
   ```
4. Import the Supabase schema dump:
   ```powershell
   psql --dbname "postgresql://postgres:<password>@localhost:5432/toofunny_media" \
        --file "C:\Apps\TooFunnyProductions\backend\docs\schema\supabase_schema.sql"
   ```
5. Run the helper DDL scripts to back-fill any columns introduced after the last dump:
   ```powershell
   psql --dbname "postgresql://postgres:<password>@localhost:5432/toofunny_media" \
        --file "C:\Apps\TooFunnyProductions\backend\docs\schema\settings-columns.sql"
   psql --dbname "postgresql://postgres:<password>@localhost:5432/toofunny_media" \
        --file "C:\Apps\TooFunnyProductions\backend\docs\schema\contact-responses.sql"
   psql --dbname "postgresql://postgres:<password>@localhost:5432/toofunny_media" \
        --file "C:\Apps\TooFunnyProductions\backend\docs\admin-actions.sql"
   ```
6. Confirm that tables, types, indexes, and constraints exist using `\dt`, `\d <table>`, and related commands inside `psql`. You can also run `psql -f backend/docs/fullChecker.sql` against both environments to diff structures.

## 5. Prepare seed and migration scripts
* The repository now includes dedicated folders under `backend/docs`:
  * `schema/` → store schema dumps or table definition scripts.
  * `data/` → place seed or migration scripts (e.g., `001_seed_media_manager.sql`).
  * `tests/` → add validation SQL (row counts, checksums) to compare environments.
* Suggested naming convention:
  * `schema/supabase_schema.sql` — exported Supabase structure.
  * `data/001_seed_media_manager.sql` — metadata inserts for the media manager tables.
  * `tests/001_verify_row_counts.sql` — validation queries after migration.

### Template for seed scripts
```sql
-- data/001_seed_media_manager.sql
BEGIN;

-- Example: insert into assets table
-- COPY assets (id, file_name, mime_type, size_bytes, storage_path, created_at)
-- FROM 'C:/path/to/assets.csv' WITH (FORMAT csv, HEADER true);

COMMIT;
```

### Template for validation scripts
```sql
-- tests/001_verify_row_counts.sql
SELECT 'assets' AS table_name,
       (SELECT COUNT(*) FROM public.assets) AS local_rows;

-- Add similar queries per table and compare against Supabase counts.
```

## 6. Export Supabase data
1. Run `pg_dump --data-only` once per table so you can stage the output inside `backend/docs/data`:
   ```powershell
   $env:PGPASSWORD="<password>"
   $pgUrl = "postgresql://<user>@<host>:<port>/<database>?sslmode=require"

   pg_dump --data-only --no-owner --no-privileges --table public.settings_draft \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\001_settings_draft.sql" $pgUrl
   pg_dump --data-only --no-owner --no-privileges --table public.settings_public \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\002_settings_public.sql" $pgUrl
   pg_dump --data-only --no-owner --no-privileges --table public.settings_lock \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\003_settings_lock.sql" $pgUrl
   pg_dump --data-only --no-owner --no-privileges --table public.settings_versions \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\004_settings_versions.sql" $pgUrl
   pg_dump --data-only --no-owner --no-privileges --table public.settings_deployments \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\005_settings_deployments.sql" $pgUrl
   pg_dump --data-only --no-owner --no-privileges --table public.admin_actions \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\006_admin_actions.sql" $pgUrl
   pg_dump --data-only --no-owner --no-privileges --table public.contact_responses \
       --file "C:\Apps\TooFunnyProductions\backend\docs\data\007_contact_responses.sql" $pgUrl
   ```
2. For very large tables (hundreds of MB+), consider exporting to CSV using `COPY ... TO STDOUT WITH CSV HEADER` so you can resume partial transfers.
3. Add a short `README` entry or changelog alongside the dump files noting the Supabase timestamp for traceability.

## 7. Import data into the local database
1. Ensure the helper DDL scripts above have been executed locally so every column exists.
2. Import the dumps in order using `psql`:
   ```powershell
   $env:PGPASSWORD="<password>"
   $localUrl = "postgresql://postgres:<password>@localhost:5432/toofunny_media"

   foreach ($file in Get-ChildItem "C:\Apps\TooFunnyProductions\backend\docs\data\*.sql" | Sort-Object Name) {
     psql --dbname $localUrl --file $file.FullName
   }
   ```
   (Or run them individually if you prefer.)
3. If you exported CSVs instead, load them with `COPY ... FROM` statements wrapped in a transaction.
4. After imports complete, run `psql -f backend/docs/fullChecker.sql` and any scripts in `backend/docs/tests` to confirm table counts and spot-check data.

## 8. Handle media files (100+ GB)
1. Designate a local media root, e.g., `H:\apps\media`.
2. If files currently reside in Supabase Storage, use the Supabase CLI or API to download each bucket:
   ```powershell
   supabase storage list
   supabase storage download <bucket> "H:\apps\media\<bucket>"
   ```
3. If you already have a local folder with the media, move or copy it into `H:\apps\media` while preserving the relative paths referenced in the database.
4. Update database records to point to the new local file paths (e.g., replace `https://<project>.supabase.co/storage/v1/object/public/...` with `file:///H:/apps/media/...`).
5. Record any path translation logic in `backend/docs/data/002_update_media_paths.sql`.

## 9. Post-migration validation
1. Run SQL scripts under `backend/docs/tests` to confirm row counts and data integrity.
2. Spot check critical workflows in the application (upload, playback, metadata editing).
3. Ensure media files open correctly from the local path and that thumbnails/previews generate as expected.
4. Keep Supabase and local databases in sync by re-running exports for any new schema changes.

## 10. Maintenance tips
* Schedule periodic `pg_dump` backups of the local database to a second drive or cloud storage.
* Monitor drive health (SMART status) and free space.
* Document any manual steps taken so future migrations or teammates can repeat the process.

With these steps complete, you’ll have a local PostgreSQL environment ready to mirror your Supabase media manager and manage large media assets from `H:\apps`.
