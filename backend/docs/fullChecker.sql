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

-- End of fullChecker.sql
