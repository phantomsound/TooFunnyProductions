# Data Migration Scripts

Place data-loading SQL files (e.g., `pg_dump --data-only` outputs or custom `COPY` scripts) in this directory. Use numeric prefixes to control execution order (e.g., `001_`, `002_`). Execute them with `psql -f` against the local PostgreSQL instance after the schema is in place.

Recommended exports (see the migration guide for exact commands):

1. `001_settings_draft.sql`
2. `002_settings_public.sql`
3. `003_settings_lock.sql`
4. `004_settings_versions.sql`
5. `005_settings_deployments.sql`
6. `006_admin_actions.sql`
7. `007_contact_responses.sql`

Add a short note in this folder whenever you refresh the dumps so you know which Supabase snapshot each file represents.
