-- ===========================================================================
-- Bulk-rewrite Supabase URLs inside JSONB columns
-- ---------------------------------------------------------------------------
-- Use this after migrating from hosted Supabase to local PostgREST to avoid
-- re-picking media manually. The script rewrites any values that match the
-- Supabase hostname pattern inside JSONB columns for the primary settings and
-- admin tables.
--
-- How to run (from psql connected to your **local** database):
--   1) Set your replacement host (no trailing slash) with \set, e.g.:
--        \set replacement_host 'http://127.0.0.1:54321'
--   2) \i backend/docs/tests/003_rewrite_supabase_urls.sql
--   3) Review the NOTICES for how many rows were updated per table/column.
--   4) If satisfied, keep the COMMIT. Otherwise ROLLBACK.
-- ===========================================================================

BEGIN;

-- Replace this with your local PostgREST base URL before running.
-- psql example: \set replacement_host 'http://127.0.0.1:54321'
\if :{?replacement_host}
\else
  \echo 'ERROR: Set replacement_host via \set replacement_host "http://127.0.0.1:54321" before running.'
  \quit
\endif

DO $$
DECLARE
  target_pattern constant text := 'https?://[^/]*\.supabase\.(co|in|net)';
  replacement_host text := :'replacement_host';
  r record;
  rows_updated bigint;
BEGIN
  IF replacement_host IS NULL OR length(trim(replacement_host)) = 0 THEN
    RAISE EXCEPTION 'replacement_host is required. Use \set replacement_host "http://127.0.0.1:54321" first.';
  END IF;

  -- Helper to rewrite strings inside arbitrary JSONB values.
  CREATE OR REPLACE FUNCTION replace_supabase_hosts(payload jsonb, pattern text, replacement text)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  AS $$
  DECLARE
    normalized text;
  BEGIN
    IF payload IS NULL THEN
      RETURN payload;
    END IF;

    CASE jsonb_typeof(payload)
      WHEN 'string' THEN
        normalized := regexp_replace(payload::text, pattern, replacement, 'gi');
        RETURN to_jsonb(normalized);
      WHEN 'array' THEN
        RETURN (
          SELECT jsonb_agg(replace_supabase_hosts(value, pattern, replacement))
          FROM jsonb_array_elements(payload)
        );
      WHEN 'object' THEN
        RETURN (
          SELECT jsonb_object_agg(key, replace_supabase_hosts(value, pattern, replacement))
          FROM jsonb_each(payload)
        );
      ELSE
        RETURN payload;
    END CASE;
  END;
  $$;

  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'jsonb'
      AND table_name IN (
        'settings_draft',
        'settings_public',
        'settings_versions',
        'settings_deployments',
        'admin_actions',
        'contact_responses'
      )
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = replace_supabase_hosts(%I, %L, %L) WHERE %I::text ~* %L',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name,
      target_pattern,
      replacement_host,
      r.column_name,
      'supabase\.(co|in|net)'
    );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Updated %.% (column %) -> % rows', r.table_schema, r.table_name, r.column_name, rows_updated;
  END LOOP;
END $$;

-- Uncomment to preview changes before committing.
-- ROLLBACK;
COMMIT;
