-- ============================================================================
-- Too Funny Productions: pgAdmin/psql full validation harness
-- ----------------------------------------------------------------------------
-- Run this script inside your local Postgres instance (the database restored
-- from Supabase) to verify the tables, columns, keys, and indexes we rely on
-- are present and shaped like the original Supabase project.
--
-- Usage (psql example):
--   psql "postgresql://postgres:<PASSWORD>@localhost:5432/toofunny" \
--     --set ON_ERROR_STOP=on \
--     --file backend/docs/tests/004_pgadmin_full_validation.sql
--
-- The output is broken into sections:
--   1) Required tables present
--   2) Column type validation
--   3) Primary/unique key validation
--   4) Index coverage (especially on UUID/JSON columns we query)
--   5) Extension sanity check (the Supabase-provided ones we depended on)
--   6) Row-count snapshot for quick drift checks
--
-- You can paste this into pgAdmin's query tool or run via psql. Everything
-- stays read-only; no objects are created or dropped.
-- ============================================================================

\echo '=== 1) Required tables present ==='
WITH required_tables AS (
  SELECT unnest(ARRAY[
    'settings_draft',
    'settings_public',
    'settings_lock',
    'settings_versions',
    'settings_deployments',
    'admin_actions',
    'contact_responses'
  ]) AS table_name
)
SELECT
  rt.table_name,
  COALESCE(t.table_schema, '(missing)') AS table_schema,
  CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'present' END AS status
FROM required_tables rt
LEFT JOIN information_schema.tables t
  ON t.table_name = rt.table_name
 AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY rt.table_name;

\echo ''
\echo '=== 2) Column type validation (compare to Supabase schema) ==='
WITH expected AS (
  SELECT * FROM (VALUES
    -- settings_draft/public shared columns
    ('settings_draft',  'id',                           'uuid'),
    ('settings_draft',  'created_at',                   'timestamp with time zone'),
    ('settings_draft',  'updated_at',                   'timestamp with time zone'),
    ('settings_draft',  'published_at',                 'timestamp with time zone'),
    ('settings_draft',  'site_title',                   'text'),
    ('settings_draft',  'site_description',             'text'),
    ('settings_draft',  'site_keywords',                'text'),
    ('settings_draft',  'logo_url',                     'text'),
    ('settings_draft',  'favicon_url',                  'text'),
    ('settings_draft',  'footer_text',                  'text'),
    ('settings_draft',  'footer_links',                 'jsonb'),
    ('settings_draft',  'admin_quick_links',            'jsonb'),
    ('settings_draft',  'admin_profiles',               'jsonb'),
    ('settings_draft',  'contactemail',                 'text'),
    ('settings_draft',  'contactphone',                 'text'),
    ('settings_draft',  'contact_socials',              'jsonb'),
    ('settings_draft',  'theme_accent',                 'text'),
    ('settings_draft',  'theme_bg',                     'text'),
    ('settings_draft',  'header_bg',                    'text'),
    ('settings_draft',  'footer_bg',                    'text'),
    ('settings_draft',  'theme_use_global',             'boolean'),
    ('settings_draft',  'session_timeout_minutes',      'integer'),
    ('settings_draft',  'maintenance_enabled',          'boolean'),
    ('settings_draft',  'maintenance_message',          'text'),
    ('settings_draft',  'maintenance_schedule_enabled', 'boolean'),
    ('settings_draft',  'maintenance_daily_start',      'text'),
    ('settings_draft',  'maintenance_daily_end',        'text'),
    ('settings_draft',  'maintenance_timezone',         'text'),
    ('settings_draft',  'hero_title',                   'text'),
    ('settings_draft',  'hero_subtext',                 'text'),
    ('settings_draft',  'hero_title_size',              'text'),
    ('settings_draft',  'hero_subtext_size',            'text'),
    ('settings_draft',  'hero_badge_size',              'text'),
    ('settings_draft',  'hero_title_font_size',         'text'),
    ('settings_draft',  'hero_subtext_font_size',       'text'),
    ('settings_draft',  'hero_badge_font_size',         'text'),
    ('settings_draft',  'hero_image_url',               'text'),
    ('settings_draft',  'featured_video_url',           'text'),
    ('settings_draft',  'who_title',                    'text'),
    ('settings_draft',  'who_body',                     'text'),
    ('settings_draft',  'who_cta_label',                'text'),
    ('settings_draft',  'who_cta_url',                  'text'),
    ('settings_draft',  'who_image_url',                'text'),
    ('settings_draft',  'about_title',                  'text'),
    ('settings_draft',  'about_body',                   'text'),
    ('settings_draft',  'about_mission_title',          'text'),
    ('settings_draft',  'about_mission_body',           'text'),
    ('settings_draft',  'about_team_intro',             'text'),
    ('settings_draft',  'about_team',                   'jsonb'),
    ('settings_draft',  'events_title',                 'text'),
    ('settings_draft',  'events_intro',                 'text'),
    ('settings_draft',  'events_upcoming',              'jsonb'),
    ('settings_draft',  'events_past',                  'jsonb'),
    ('settings_draft',  'media_title',                  'text'),
    ('settings_draft',  'media_intro',                  'text'),
    ('settings_draft',  'media_sections',               'jsonb'),
    ('settings_draft',  'merch_title',                  'text'),
    ('settings_draft',  'merch_intro',                  'text'),
    ('settings_draft',  'merch_items',                  'jsonb'),
    ('settings_draft',  'contact_title',                'text'),
    ('settings_draft',  'contact_intro',                'text'),
    ('settings_draft',  'contact_cards',                'jsonb'),

    ('settings_public', 'id',                           'uuid'),
    ('settings_public', 'created_at',                   'timestamp with time zone'),
    ('settings_public', 'updated_at',                   'timestamp with time zone'),
    ('settings_public', 'published_at',                 'timestamp with time zone'),
    ('settings_public', 'site_title',                   'text'),
    ('settings_public', 'site_description',             'text'),
    ('settings_public', 'site_keywords',                'text'),
    ('settings_public', 'logo_url',                     'text'),
    ('settings_public', 'favicon_url',                  'text'),
    ('settings_public', 'footer_text',                  'text'),
    ('settings_public', 'footer_links',                 'jsonb'),
    ('settings_public', 'admin_quick_links',            'jsonb'),
    ('settings_public', 'admin_profiles',               'jsonb'),
    ('settings_public', 'contactemail',                 'text'),
    ('settings_public', 'contactphone',                 'text'),
    ('settings_public', 'contact_socials',              'jsonb'),
    ('settings_public', 'theme_accent',                 'text'),
    ('settings_public', 'theme_bg',                     'text'),
    ('settings_public', 'header_bg',                    'text'),
    ('settings_public', 'footer_bg',                    'text'),
    ('settings_public', 'theme_use_global',             'boolean'),
    ('settings_public', 'session_timeout_minutes',      'integer'),
    ('settings_public', 'maintenance_enabled',          'boolean'),
    ('settings_public', 'maintenance_message',          'text'),
    ('settings_public', 'maintenance_schedule_enabled', 'boolean'),
    ('settings_public', 'maintenance_daily_start',      'text'),
    ('settings_public', 'maintenance_daily_end',        'text'),
    ('settings_public', 'maintenance_timezone',         'text'),
    ('settings_public', 'hero_title',                   'text'),
    ('settings_public', 'hero_subtext',                 'text'),
    ('settings_public', 'hero_title_size',              'text'),
    ('settings_public', 'hero_subtext_size',            'text'),
    ('settings_public', 'hero_badge_size',              'text'),
    ('settings_public', 'hero_title_font_size',         'text'),
    ('settings_public', 'hero_subtext_font_size',       'text'),
    ('settings_public', 'hero_badge_font_size',         'text'),
    ('settings_public', 'hero_image_url',               'text'),
    ('settings_public', 'featured_video_url',           'text'),
    ('settings_public', 'who_title',                    'text'),
    ('settings_public', 'who_body',                     'text'),
    ('settings_public', 'who_cta_label',                'text'),
    ('settings_public', 'who_cta_url',                  'text'),
    ('settings_public', 'who_image_url',                'text'),
    ('settings_public', 'about_title',                  'text'),
    ('settings_public', 'about_body',                   'text'),
    ('settings_public', 'about_mission_title',          'text'),
    ('settings_public', 'about_mission_body',           'text'),
    ('settings_public', 'about_team_intro',             'text'),
    ('settings_public', 'about_team',                   'jsonb'),
    ('settings_public', 'events_title',                 'text'),
    ('settings_public', 'events_intro',                 'text'),
    ('settings_public', 'events_upcoming',              'jsonb'),
    ('settings_public', 'events_past',                  'jsonb'),
    ('settings_public', 'media_title',                  'text'),
    ('settings_public', 'media_intro',                  'text'),
    ('settings_public', 'media_sections',               'jsonb'),
    ('settings_public', 'merch_title',                  'text'),
    ('settings_public', 'merch_intro',                  'text'),
    ('settings_public', 'merch_items',                  'jsonb'),
    ('settings_public', 'contact_title',                'text'),
    ('settings_public', 'contact_intro',                'text'),
    ('settings_public', 'contact_cards',                'jsonb'),

    -- supporting tables
    ('settings_lock',    'id',                          'integer'),
    ('settings_lock',    'holder_email',                'text'),
    ('settings_lock',    'acquired_at',                 'timestamp with time zone'),
    ('settings_lock',    'expires_at',                  'timestamp with time zone'),
    ('settings_lock',    'created_at',                  'timestamp with time zone'),
    ('settings_lock',    'updated_at',                  'timestamp with time zone'),
    ('settings_lock',    'active_version_id',           'uuid'),
    ('settings_lock',    'source_version_id',           'uuid'),
    ('settings_lock',    'auto_saved_version_id',       'uuid'),

    ('settings_versions','id',                          'uuid'),
    ('settings_versions','stage',                       'text'),
    ('settings_versions','label',                       'text'),
    ('settings_versions','author_email',                'text'),
    ('settings_versions','data',                        'jsonb'),
    ('settings_versions','status',                      'text'),
    ('settings_versions','created_at',                  'timestamp with time zone'),
    ('settings_versions','note',                        'text'),
    ('settings_versions','kind',                        'text'),
    ('settings_versions','updated_at',                  'timestamp with time zone'),
    ('settings_versions','published_at',                'timestamp with time zone'),
    ('settings_versions','is_default',                  'boolean'),

    ('settings_deployments','id',                       'uuid'),
    ('settings_deployments','snapshot_id',              'uuid'),
    ('settings_deployments','fallback_snapshot_id',     'uuid'),
    ('settings_deployments','start_at',                 'timestamp with time zone'),
    ('settings_deployments','end_at',                   'timestamp with time zone'),
    ('settings_deployments','status',                   'text'),
    ('settings_deployments','created_at',               'timestamp with time zone'),
    ('settings_deployments','updated_at',               'timestamp with time zone'),
    ('settings_deployments','created_by',               'text'),
    ('settings_deployments','updated_by',               'text'),
    ('settings_deployments','cancelled_at',             'timestamp with time zone'),
    ('settings_deployments','cancelled_by',             'text'),
    ('settings_deployments','override_reason',          'text'),
    ('settings_deployments','activated_at',             'timestamp with time zone'),
    ('settings_deployments','completed_at',             'timestamp with time zone'),

    ('admin_actions',      'id',                        'uuid'),
    ('admin_actions',      'occurred_at',               'timestamp with time zone'),
    ('admin_actions',      'actor_email',               'text'),
    ('admin_actions',      'action',                    'text'),
    ('admin_actions',      'meta',                      'jsonb'),
    ('admin_actions',      'payload',                   'jsonb'),
    ('admin_actions',      'created_at',                'timestamp with time zone'),

    ('contact_responses',  'id',                        'uuid'),
    ('contact_responses',  'created_at',                'timestamp with time zone'),
    ('contact_responses',  'updated_at',                'timestamp with time zone'),
    ('contact_responses',  'name',                      'text'),
    ('contact_responses',  'email',                     'text'),
    ('contact_responses',  'message',                   'text'),
    ('contact_responses',  'responded',                 'boolean'),
    ('contact_responses',  'responded_at',              'timestamp with time zone'),
    ('contact_responses',  'responded_by',              'text'),
    ('contact_responses',  'notes',                     'text'),
    ('contact_responses',  'delivery_status',           'text'),
    ('contact_responses',  'delivery_error',            'text'),
    ('contact_responses',  'meta',                      'jsonb')
  ) AS v(table_name, column_name, expected_type)
),
actual AS (
  SELECT table_schema, table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
)
SELECT
  e.table_name,
  e.column_name,
  e.expected_type,
  a.data_type AS actual_type,
  CASE
    WHEN a.column_name IS NULL THEN 'MISSING'
    WHEN a.data_type <> e.expected_type THEN 'TYPE_MISMATCH'
    ELSE 'ok'
  END AS status,
  a.table_schema
FROM expected e
LEFT JOIN actual a
  ON a.table_name = e.table_name
 AND a.column_name = e.column_name
ORDER BY e.table_name, e.column_name;

\echo ''
\echo '=== 3) Primary and unique key coverage ==='
WITH expected_keys AS (
  SELECT * FROM (VALUES
    ('settings_draft',      'PRIMARY KEY', ARRAY['id']),
    ('settings_public',     'PRIMARY KEY', ARRAY['id']),
    ('settings_lock',       'PRIMARY KEY', ARRAY['id']),
    ('settings_versions',   'PRIMARY KEY', ARRAY['id']),
    ('settings_deployments','PRIMARY KEY', ARRAY['id']),
    ('admin_actions',       'PRIMARY KEY', ARRAY['id']),
    ('contact_responses',   'PRIMARY KEY', ARRAY['id'])
  ) AS v(table_name, constraint_type, columns)
),
actual_keys AS (
  SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_type,
    tc.constraint_name,
    ARRAY_AGG(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema   = kcu.table_schema
  WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
  GROUP BY tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name
)
SELECT
  e.table_name,
  e.constraint_type,
  e.columns AS expected_columns,
  a.columns AS actual_columns,
  a.constraint_name,
  CASE
    WHEN a.table_name IS NULL THEN 'MISSING'
    WHEN a.columns IS DISTINCT FROM e.columns THEN 'COLUMN_MISMATCH'
    ELSE 'ok'
  END AS status,
  a.table_schema
FROM expected_keys e
LEFT JOIN actual_keys a
  ON a.table_name = e.table_name
 AND a.constraint_type = e.constraint_type
ORDER BY e.table_name, e.constraint_type;

\echo ''
\echo '=== 4) Index coverage on UUID and JSONB columns ==='
WITH important_indexes AS (
  SELECT * FROM (VALUES
    ('settings_versions', 'settings_versions_pkey'),
    ('settings_deployments', 'settings_deployments_pkey'),
    ('admin_actions', 'admin_actions_pkey'),
    ('contact_responses', 'contact_responses_pkey')
  ) AS v(table_name, index_name)
)
SELECT
  COALESCE(i.schemaname, '(missing)') AS table_schema,
  COALESCE(i.tablename, ii.table_name) AS table_name,
  ii.index_name,
  CASE WHEN i.indexname IS NULL THEN 'MISSING' ELSE 'present' END AS status,
  i.indexdef    AS definition
FROM important_indexes ii
LEFT JOIN pg_indexes i
  ON i.tablename = ii.table_name
 AND i.indexname = ii.index_name
WHERE COALESCE(i.schemaname, 'public') NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_name, index_name;

\echo ''
\echo '=== 5) Supabase extension sanity check (local instance should mirror) ==='
SELECT
  extname,
  extversion,
  CASE WHEN extname IN ('pgcrypto', 'pg_graphql', 'uuid-ossp', 'supabase_vault', 'pg_stat_statements', 'pg_net')
       THEN 'expected'
       ELSE 'extra'
  END AS classification
FROM pg_extension
ORDER BY classification DESC, extname;

\echo ''
\echo '=== 6) Row-count snapshot for drift detection ==='
WITH stats AS (
  SELECT
    n.nspname AS table_schema,
    c.relname AS table_name,
    c.reltuples::bigint AS estimated_rows,
    pg_total_relation_size(c.oid) AS total_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND c.relname IN (
      'settings_draft','settings_public','settings_lock','settings_versions',
      'settings_deployments','admin_actions','contact_responses'
    )
)
SELECT * FROM stats ORDER BY table_schema, table_name;

-- Also print exact row counts for the high-signal tables (fast enough for our size)
SELECT
  'settings_versions' AS table_name, COUNT(*) AS rows FROM public.settings_versions UNION ALL
SELECT 'settings_deployments', COUNT(*) FROM public.settings_deployments UNION ALL
SELECT 'admin_actions', COUNT(*) FROM public.admin_actions UNION ALL
SELECT 'settings_draft', COUNT(*) FROM public.settings_draft UNION ALL
SELECT 'settings_public', COUNT(*) FROM public.settings_public UNION ALL
SELECT 'settings_lock', COUNT(*) FROM public.settings_lock UNION ALL
SELECT 'contact_responses', COUNT(*) FROM public.contact_responses
ORDER BY table_name;

-- End of 004_pgadmin_full_validation.sql
