-- ===========================================================================
-- Bulk-rewrite local Supabase URLs inside JSONB columns
-- ---------------------------------------------------------------------------
-- Use this after moving from a local Supabase/PostgREST stack to a hosted
-- endpoint to avoid re-picking media manually. The script rewrites any values
-- that match localhost/127.0.0.1/0.0.0.0 hosts inside JSONB columns for the
-- primary settings and admin tables.
--
-- How to run (connected to your **production** database):
--   1) Identify your replacement host. Use the PostgREST base URL you want
--      browsers to use for Supabase storage, for example:
--        - `https://<your-project>.supabase.co`
--        - `https://<your-api-host>`
--   2) In your SQL client, set a custom parameter named `replacement_host`
--      before executing this file. Examples:
--        psql (one command):
--          psql -d <db> -c "SET replacement_host = '<host>';" \
--                 -f backend/docs/tests/004_rewrite_local_media_urls.sql
--        psql (interactive):
--          SET replacement_host = '<host>';
--          \i backend/docs/tests/004_rewrite_local_media_urls.sql
--        pgAdmin Query Tool:
--          run `SET replacement_host = '<host>';` then run this script
--   3) Review the NOTICES for how many rows were updated per table/column.
--   4) If satisfied, keep the COMMIT. Otherwise ROLLBACK.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  target_pattern constant text := 'https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:\\d+)?';
  replacement_host text := current_setting('replacement_host', true);
  r record;
  rows_updated bigint;
BEGIN
  IF replacement_host IS NULL OR length(trim(replacement_host)) = 0 THEN
    RAISE EXCEPTION 'replacement_host is required. Run `SET replacement_host = ''https://example.supabase.co'';` first.';
  END IF;

  -- Helper to rewrite strings inside arbitrary JSONB values.
  CREATE OR REPLACE FUNCTION replace_local_hosts(payload jsonb, pattern text, replacement text)
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
          SELECT jsonb_agg(replace_local_hosts(value, pattern, replacement))
          FROM jsonb_array_elements(payload)
        );
      WHEN 'object' THEN
        RETURN (
          SELECT jsonb_object_agg(key, replace_local_hosts(value, pattern, replacement))
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
      'UPDATE %I.%I SET %I = replace_local_hosts(%I, %L, %L) WHERE %I::text ~* %L',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name,
      target_pattern,
      replacement_host,
      r.column_name,
      '(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)'
    );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Updated %.% (column %) -> % rows', r.table_schema, r.table_name, r.column_name, rows_updated;
  END LOOP;
END $$;

-- Uncomment to preview changes before committing.
-- ROLLBACK;
COMMIT;
