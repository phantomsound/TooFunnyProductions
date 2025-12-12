-- 002_admin_actions.sql
-- Purpose: Create/normalize the audit trail for administrator actions.
-- Run order: execute after 001_settings_schema.sql so reference tables exist.

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. Audit log table
-- =====================================================================
create table if not exists admin_actions (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_email text,
  action text not null,
  meta jsonb,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table admin_actions
  add column if not exists occurred_at timestamptz not null default now(),
  add column if not exists actor_email text,
  add column if not exists action text not null,
  add column if not exists meta jsonb,
  add column if not exists payload jsonb,
  add column if not exists created_at timestamptz not null default now();

-- =====================================================================
-- 2. Helpful indexes for querying activity
-- =====================================================================
create index if not exists idx_admin_actions_occurred_at on admin_actions (occurred_at desc);
create index if not exists idx_admin_actions_actor on admin_actions (actor_email);
create index if not exists idx_admin_actions_action on admin_actions (action);
