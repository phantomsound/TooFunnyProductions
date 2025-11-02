-- fullChecker.sql
--
-- This script inspects your Supabase (PostgreSQL) database schema to ensure
-- that every table, column, constraint, and index is defined as expected.
--
-- How to use:
--   * Run the entire file in the Supabase SQL editor or psql.
--   * Compare the results to your expected schema definition.
--   * Adjust the filters (e.g., schema name) if you need to scope the output.

-- ================================================
-- 1. List all tables (excluding system schemas)
-- ================================================
select table_schema,
       table_name,
       table_type
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name;

-- ================================================
-- 2. List columns for every table
-- ================================================
select table_schema,
       table_name,
       column_name,
       ordinal_position,
       data_type,
       is_nullable,
       column_default
from information_schema.columns
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name, ordinal_position;

-- ================================================
-- 3. List primary keys and unique constraints
-- ================================================
select
    tc.table_schema,
    tc.table_name,
    tc.constraint_type,
    tc.constraint_name,
    string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema   = kcu.table_schema
where tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
group by tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name
order by tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name;

-- ================================================
-- 4. List foreign key relationships
-- ================================================
select
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_schema as foreign_table_schema,
    ccu.table_name  as foreign_table_name,
    ccu.column_name as foreign_column_name,
    rc.update_rule,
    rc.delete_rule
from information_schema.table_constraints as tc
join information_schema.key_column_usage as kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema   = kcu.table_schema
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_name = tc.constraint_name
join information_schema.referential_constraints as rc
  on rc.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.column_name;

-- ================================================
-- 5. List indexes (including non-key indexes)
-- ================================================
select
    schemaname  as table_schema,
    tablename   as table_name,
    indexname   as index_name,
    indexdef    as definition
from pg_indexes
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename, indexname;

-- ================================================
-- 6. View check constraints
-- ================================================
select
    connamespace::regnamespace as table_schema,
    conrelid::regclass         as table_name,
    conname                    as constraint_name,
    pg_get_constraintdef(oid)  as definition
from pg_constraint
where contype = 'c'
order by connamespace::regnamespace, conrelid::regclass, conname;

-- ================================================
-- 7. Estimate row counts per table
--    (Use select count(*) for exact counts if needed)
-- ================================================
select table_schema,
       table_name,
       row_estimate
from (
    select n.nspname as table_schema,
           c.relname as table_name,
           c.reltuples::bigint as row_estimate
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname not in ('pg_catalog', 'information_schema')
) t
order by table_schema, table_name;

-- ================================================
-- 8. Verify Supabase migration history (if applicable)
-- ================================================
-- Uncomment the block below if you are using Supabase migrations. Adjust the
-- schema/table name if you renamed the migrations schema.
-- select *
--   from supabase_migrations.schema_migrations
--  order by version;

-- ================================================
-- 9. Verify presence of critical settings tables
-- ================================================
with required_tables as (
  select unnest(array['settings_draft', 'settings_public', 'settings_lock', 'settings_versions']) as table_name
)
select
  rt.table_name,
  coalesce(t.table_schema, '(missing)') as table_schema,
  case when t.table_name is null then 'MISSING' else 'present' end as status
from required_tables rt
left join information_schema.tables t
  on t.table_name = rt.table_name
 and t.table_schema not in ('pg_catalog', 'information_schema')
order by rt.table_name;

-- ================================================
-- 10. Validate expected columns in settings tables
-- ================================================
with expected as (
  select * from (values
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
    ('settings_deployments','completed_at',             'timestamp with time zone')
  ) as v(table_name, column_name, expected_type)
), actual as (
  select table_schema, table_name, column_name, data_type
  from information_schema.columns
  where table_schema not in ('pg_catalog', 'information_schema')
)
select
  e.table_name,
  e.column_name,
  e.expected_type,
  a.data_type as actual_type,
  case
    when a.column_name is null then 'MISSING'
    when a.data_type <> e.expected_type then 'TYPE_MISMATCH'
    else 'ok'
  end as status,
  a.table_schema
from expected e
left join actual a
  on a.table_name = e.table_name
 and a.column_name = e.column_name
order by e.table_name, e.column_name;

-- End of fullChecker.sql
