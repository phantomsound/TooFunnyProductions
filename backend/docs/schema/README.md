# Schema Artifacts

Store exported Supabase schema files and custom DDL scripts here. The primary export should be saved as `supabase_schema.sql` using the `pg_dump --schema-only` command outlined in `../local-postgres-migration-guide.md`.

## Included helper DDL

* `settings-columns.sql` – hardens the site settings tables plus supporting deployment/version tables.
* `contact-responses.sql` – provisions the `contact_responses` table used by the contact form.
* `../admin-actions.sql` – creates and backfills the `admin_actions` audit log table.

Run these helper scripts in both Supabase and your local PostgreSQL instance before importing data dumps so every column and constraint exists.
