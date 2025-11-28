-- ===========================================================================
-- Supabase ↔ Local comparison harness
-- ---------------------------------------------------------------------------
-- Run this inside your **local** toofunny database to cross-check data against
-- the hosted Supabase project. Replace every <PLACEHOLDER> before executing.
--
-- Prerequisites:
--   * The `postgres_fdw` extension is available on the local instance.
--   * The Supabase project allows network access from your machine.
--   * You are comfortable storing the Supabase credentials in the session (or
--     comment out the CREATE USER MAPPING section and create the mapping
--     manually before running the rest of the script).
--
--   1. Provide the Supabase connection settings via psql variables (for example
--      `psql -v SUPABASE_HOST="aws-0-us-east-1.pooler.supabase.com" -v SUPABASE_PORT=6543 -v SUPABASE_DB=postgres -v SUPABASE_USER=postgres.<project-id> -v SUPABASE_PASSWORD=*** -f backend/docs/tests/002_compare_supabase_fdw.sql`).
--   2. \i this file from psql while connected to the local database.
--   3. Inspect the row-count diff, EXCEPT outputs, and hash mismatches.
--   4. Investigate any rows printed before proceeding with cutover.
--   5. Run the teardown block at the bottom when you no longer need the FDW.
-- ===========================================================================

-- Require Supabase connection variables to be set by the caller so we avoid
-- committing secrets while still keeping the script runnable.
\if :{?SUPABASE_HOST}
\else
  \echo 'ERROR: set SUPABASE_HOST (psql -v SUPABASE_HOST=...) before running.'
  \quit 1
\endif

\if :{?SUPABASE_PORT}
\else
  \echo 'ERROR: set SUPABASE_PORT (psql -v SUPABASE_PORT=...) before running.'
  \quit 1
\endif

\if :{?SUPABASE_DB}
\else
  \echo 'ERROR: set SUPABASE_DB (psql -v SUPABASE_DB=...) before running.'
  \quit 1
\endif

\if :{?SUPABASE_USER}
\else
  \echo 'ERROR: set SUPABASE_USER (psql -v SUPABASE_USER=...) before running.'
  \quit 1
\endif

\if :{?SUPABASE_PASSWORD}
\else
  \echo 'ERROR: set SUPABASE_PASSWORD (psql -v SUPABASE_PASSWORD=...) before running.'
  \quit 1
\endif

-- Quote the provided values so they can be safely injected below.
SELECT
  quote_literal(:'SUPABASE_HOST') AS supabase_host_literal,
  quote_literal(:'SUPABASE_PORT') AS supabase_port_literal,
  quote_literal(:'SUPABASE_DB') AS supabase_db_literal,
  quote_literal(:'SUPABASE_USER') AS supabase_user_literal,
  quote_literal(:'SUPABASE_PASSWORD') AS supabase_password_literal
\gset

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

DROP SERVER IF EXISTS supabase_remote CASCADE;
CREATE SERVER supabase_remote
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    host :supabase_host_literal,
    dbname :supabase_db_literal,
    port :supabase_port_literal
  );

CREATE USER MAPPING FOR CURRENT_USER
  SERVER supabase_remote
  OPTIONS (
    user :supabase_user_literal,
    password :supabase_password_literal
  );

DROP SCHEMA IF EXISTS supabase_mirror CASCADE;
CREATE SCHEMA supabase_mirror;

IMPORT FOREIGN SCHEMA public
  LIMIT TO (
    settings_draft,
    settings_public,
    settings_lock,
    settings_versions,
    settings_deployments,
    admin_actions
  )
  FROM SERVER supabase_remote
  INTO supabase_mirror;

COMMIT;

-- ---------------------------------------------------------------------------
-- 1. Row-count comparison
-- ---------------------------------------------------------------------------
WITH supabase_counts AS (
  SELECT 'settings_draft' AS table_name, COUNT(*) AS supabase_rows FROM supabase_mirror.settings_draft UNION ALL
  SELECT 'settings_public', COUNT(*) FROM supabase_mirror.settings_public UNION ALL
  SELECT 'settings_lock', COUNT(*) FROM supabase_mirror.settings_lock UNION ALL
  SELECT 'settings_versions', COUNT(*) FROM supabase_mirror.settings_versions UNION ALL
  SELECT 'settings_deployments', COUNT(*) FROM supabase_mirror.settings_deployments UNION ALL
  SELECT 'admin_actions', COUNT(*) FROM supabase_mirror.admin_actions
),
local_counts AS (
  SELECT 'settings_draft' AS table_name, COUNT(*) AS local_rows FROM public.settings_draft UNION ALL
  SELECT 'settings_public', COUNT(*) FROM public.settings_public UNION ALL
  SELECT 'settings_lock', COUNT(*) FROM public.settings_lock UNION ALL
  SELECT 'settings_versions', COUNT(*) FROM public.settings_versions UNION ALL
  SELECT 'settings_deployments', COUNT(*) FROM public.settings_deployments UNION ALL
  SELECT 'admin_actions', COUNT(*) FROM public.admin_actions
)
SELECT
  l.table_name,
  l.local_rows,
  s.supabase_rows,
  l.local_rows - s.supabase_rows AS row_diff
FROM local_counts l
JOIN supabase_counts s USING (table_name)
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- 2. Data-diff spot checks (EXCEPT). These return rows that do not match.
-- ---------------------------------------------------------------------------
-- Uncomment the tables you want to inspect.
--
-- SELECT 'settings_draft_local_only' AS diff_type, *
-- FROM (
--   SELECT * FROM public.settings_draft
--   EXCEPT
--   SELECT * FROM supabase_mirror.settings_draft
-- ) diff
-- LIMIT 20;
--
-- SELECT 'settings_draft_supabase_only' AS diff_type, *
-- FROM (
--   SELECT * FROM supabase_mirror.settings_draft
--   EXCEPT
--   SELECT * FROM public.settings_draft
-- ) diff
-- LIMIT 20;

-- ---------------------------------------------------------------------------
-- 3. Hash-based comparison for large JSON tables (faster than EXCEPT).
-- ---------------------------------------------------------------------------
WITH supabase_hash AS (
  SELECT id, md5(row_to_json(t)::text) AS supabase_md5
  FROM supabase_mirror.settings_versions t
),
local_hash AS (
  SELECT id, md5(row_to_json(t)::text) AS local_md5
  FROM public.settings_versions t
)
SELECT
  COALESCE(l.id, s.id) AS id,
  l.local_md5,
  s.supabase_md5,
  CASE WHEN l.local_md5 = s.supabase_md5 THEN 'match' ELSE 'DIFFERS' END AS status
FROM local_hash l
FULL OUTER JOIN supabase_hash s USING (id)
WHERE COALESCE(l.local_md5, '') <> COALESCE(s.supabase_md5, '')
ORDER BY id
LIMIT 50;

-- ---------------------------------------------------------------------------
-- 4. Scan for lingering Supabase URLs inside local text/JSON columns.
-- ---------------------------------------------------------------------------
WITH candidates AS (
  SELECT 'settings_draft'::text AS table_name, id, row_to_json(t) AS payload
  FROM public.settings_draft t
  UNION ALL
  SELECT 'settings_public', id, row_to_json(t) FROM public.settings_public t
  UNION ALL
  SELECT 'settings_versions', id, row_to_json(t) FROM public.settings_versions t
  UNION ALL
  SELECT 'admin_actions', id, row_to_json(t) FROM public.admin_actions t
)
SELECT
  table_name,
  id,
  jsonb_path_query(payload::jsonb, '$.** ? (@ like_regex "supabase\\\.(co|in|net)")') AS offending_values
FROM candidates
WHERE jsonb_path_exists(payload::jsonb, '$.** ? (@ like_regex "supabase\\\.(co|in|net)")');

-- ---------------------------------------------------------------------------
-- 5. Teardown helper (run after you finish validating to drop the FDW).
-- ---------------------------------------------------------------------------
-- DROP SCHEMA IF EXISTS supabase_mirror CASCADE;
-- DROP SERVER IF EXISTS supabase_remote CASCADE;

