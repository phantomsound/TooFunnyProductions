# Supabase → Local validation flow

`scripts/db-agent.js` orchestrates exporting a Supabase schema dump, restoring it locally, and running the FDW comparison harness. It is a light wrapper around `scripts/migrate-supabase.js` so you can reuse the same migration steps in a single command.

## Usage

```bash
npm run db:sync-validate -- \
  --supabase-url=postgresql://user:password@host:6543/postgres?sslmode=require \
  --local-url=postgresql://postgres:postgres@localhost:5432/toofunny \
  --admin-db=postgres \
  --report-path=backend/docs/reports/fdw-report.log
```

Flags:

- `--supabase-url`: Hosted Supabase connection string (required for non-interactive runs).
- `--local-url`: Local database connection string to restore into (required for non-interactive runs).
- `--admin-db`: Admin database used to drop/create the target database (default: `postgres`).
- `--report-path`: Optional path for the generated FDW comparison report (defaults to `backend/docs/reports/fdw-compare-<timestamp>.log`).
- `--skip-export`: Reuse an existing schema dump at `backend/docs/schema/supabase_schema.sql` instead of exporting from Supabase.

If any required flags are omitted the agent will prompt for values interactively.

## What the agent does

1. Ensures `pg_dump` and `psql` are available.
2. Exports the Supabase schema (unless `--skip-export` is provided) to `backend/docs/schema/supabase_schema.sql`.
3. Drops and recreates the local database before applying the schema.
4. Runs `backend/docs/tests/002_compare_supabase_fdw.sql` against the local database, passing the Supabase connection variables.
5. Writes a report to stdout and `backend/docs/reports/` summarizing row-count differences, hash mismatches, and Supabase URL references.

The FDW script requires connectivity from your local PostgreSQL instance to the Supabase host. The agent redacts the password in logged commands but stores it in the report output produced by `psql`, so keep the generated report files secure.
