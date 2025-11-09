# Validation Queries

Add SQL files here that verify the integrity of the migrated data (row counts, checksums, path checks). Run these scripts after executing the schema and data migrations to confirm parity with Supabase.

## Included helpers

### `002_compare_supabase_fdw.sql`

End-to-end harness that temporarily links your local database back to Supabase via `postgres_fdw`. It performs row-count diffs, optional `EXCEPT` spot checks, a hash comparison over `settings_versions`, and a sweep for lingering Supabase-hosted URLs. Replace the placeholder credentials at the top before executing the script from `psql`.

When you are done validating, run the teardown block at the bottom of the file (drops the foreign schema/server) so the Supabase credentials are not left behind on the local instance.

### Custom checks

Add additional numbered files (e.g., `010_verify_events_counts.sql`) as your migration expands to more tables. Keeping each check focused makes it easier to rerun only the scripts that matter for a given cutover.
