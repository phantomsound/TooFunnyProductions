# Supabase → Local validation flow

`scripts/db-agent.js` orchestrates exporting a Supabase schema dump, restoring it locally, and running the FDW comparison harness. It is a light wrapper around `scripts/migrate-supabase.js` so you can reuse the same migration steps in a single command.

## Usage

```bash
npm run db:sync-validate -- \
  --supabase-url=postgresql://user:password@host:6543/postgres?sslmode=require \
  --local-url=postgresql://postgres:postgres@localhost:5432/toofunny \
  --admin-db=postgres \
  --report-path=backend/docs/reports/fdw-report.log \
  --include-data \
  --validation-base-url=http://localhost:3000
```

Flags:

- `--supabase-url`: Hosted Supabase connection string (required for non-interactive runs).
- `--local-url`: Local database connection string to restore into (required for non-interactive runs).
- `--admin-db`: Admin database used to drop/create the target database (default: `postgres`).
- `--report-path`: Optional path for the generated FDW comparison report (defaults to `backend/docs/reports/fdw-compare-<timestamp>.log`).
- `--skip-export`: Reuse an existing schema dump at `backend/docs/schema/supabase_schema.sql` instead of exporting from Supabase.
- `--include-data`: Export a full Supabase dump (schema + data) to `backend/docs/schema/supabase_full.sql` and restore it locally before validation/comparison.
- `--validation-base-url`: Base URL used for HTTP validation checks (default: `http://localhost:3000`; omit to skip HTTP validation).

If any required flags are omitted the agent will prompt for values interactively.

## What the agent does

1. Ensures `pg_dump` and `psql` are available.
2. Exports the Supabase schema (unless `--skip-export` is provided) to `backend/docs/schema/supabase_schema.sql`. When `--include-data` is set, it also exports a full dump to `backend/docs/schema/supabase_full.sql`.
3. Drops and recreates the local database before applying the selected dump (schema-only by default, or schema+data when `--include-data` is provided).
4. Runs post-restore validation checks (SQL sanity checks plus an optional HTTP health check using `--validation-base-url`) and appends the pass/fail details to the final report.
5. Runs `backend/docs/tests/002_compare_supabase_fdw.sql` against the local database, passing the Supabase connection variables.
6. Writes a report to stdout and `backend/docs/reports/` summarizing validation results, row-count differences, hash mismatches, Supabase URL references, and any retry diagnostics.

The FDW script requires connectivity from your local PostgreSQL instance to the Supabase host. The agent redacts the password in logged commands but stores it in the report output produced by `psql`, so keep the generated report files secure.
