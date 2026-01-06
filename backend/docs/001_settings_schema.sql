-- 001_settings_schema.sql
-- Purpose: Provision and normalize all settings-related tables used by Too Funny Productions.
-- Run order: execute this file first to create base tables and indexes before other scripts.

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. Core settings tables (draft + public)
-- =====================================================================
create table if not exists settings_draft (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  published_at timestamptz
);

create table if not exists settings_public (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  published_at timestamptz
);

-- Ensure foundational timestamps exist and have sane defaults
alter table settings_draft  add column if not exists created_at timestamptz default now();
alter table settings_public add column if not exists created_at timestamptz default now();
alter table settings_draft  alter column created_at set default now();
alter table settings_public alter column created_at set default now();

alter table settings_draft  add column if not exists updated_at timestamptz default now();
alter table settings_public add column if not exists updated_at timestamptz;

alter table settings_draft  add column if not exists published_at timestamptz;
alter table settings_public add column if not exists published_at timestamptz;

-- =====================================================================
-- 2. Branding & SEO metadata
-- =====================================================================
alter table settings_draft  add column if not exists site_title text default 'Too Funny Productions';
alter table settings_public add column if not exists site_title text;

alter table settings_draft  add column if not exists site_description text default '';
alter table settings_public add column if not exists site_description text;

alter table settings_draft  add column if not exists site_keywords text default '';
alter table settings_public add column if not exists site_keywords text;

alter table settings_draft  add column if not exists logo_url text;
alter table settings_public add column if not exists logo_url text;

alter table settings_draft  add column if not exists favicon_url text;
alter table settings_public add column if not exists favicon_url text;

alter table settings_draft  add column if not exists footer_text text default '© 2025 Too Funny Productions. All rights reserved.';
alter table settings_public add column if not exists footer_text text;

alter table settings_draft  add column if not exists footer_links jsonb default '[]'::jsonb;
alter table settings_public add column if not exists footer_links jsonb default '[]'::jsonb;
alter table settings_draft  add column if not exists admin_quick_links jsonb default '[]'::jsonb;
alter table settings_public add column if not exists admin_quick_links jsonb default '[]'::jsonb;
alter table settings_draft  add column if not exists admin_profiles jsonb default '[]'::jsonb;
alter table settings_public add column if not exists admin_profiles jsonb default '[]'::jsonb;

alter table settings_draft  add column if not exists contactemail text;
alter table settings_public add column if not exists contactemail text;

alter table settings_draft  add column if not exists contactphone text;
alter table settings_public add column if not exists contactphone text;

alter table settings_draft  add column if not exists contact_socials jsonb default '{}'::jsonb;
alter table settings_public add column if not exists contact_socials jsonb default '{}'::jsonb;
alter table settings_draft  alter column contact_socials set default '{}'::jsonb;
alter table settings_public alter column contact_socials set default '{}'::jsonb;

alter table settings_draft  add column if not exists theme_accent text default '#FFD700';
alter table settings_public add column if not exists theme_accent text;

alter table settings_draft  add column if not exists theme_bg text default '#111111';
alter table settings_public add column if not exists theme_bg text;

alter table settings_draft  add column if not exists header_bg text default '#000000';
alter table settings_public add column if not exists header_bg text;

alter table settings_draft  add column if not exists footer_bg text default '#000000';
alter table settings_public add column if not exists footer_bg text;

alter table settings_draft  add column if not exists theme_use_global boolean default true;
alter table settings_public add column if not exists theme_use_global boolean default true;

-- =====================================================================
-- 3. Admin session controls
-- =====================================================================
alter table settings_draft  add column if not exists session_timeout_minutes integer default 30;
alter table settings_public add column if not exists session_timeout_minutes integer;

-- =====================================================================
-- 4. Maintenance controls
-- =====================================================================
alter table settings_draft  add column if not exists maintenance_enabled boolean default false;
alter table settings_public add column if not exists maintenance_enabled boolean default false;

alter table settings_draft  add column if not exists maintenance_message text default 'We’ll be right back…';
alter table settings_public add column if not exists maintenance_message text;

alter table settings_draft  add column if not exists maintenance_schedule_enabled boolean default false;
alter table settings_public add column if not exists maintenance_schedule_enabled boolean default false;

alter table settings_draft  add column if not exists maintenance_daily_start text default '';
alter table settings_public add column if not exists maintenance_daily_start text;

alter table settings_draft  add column if not exists maintenance_daily_end text default '';
alter table settings_public add column if not exists maintenance_daily_end text;

alter table settings_draft  add column if not exists maintenance_timezone text default 'America/Chicago';
alter table settings_public add column if not exists maintenance_timezone text;

-- =====================================================================
-- 5. Homepage spotlight content
-- =====================================================================
alter table settings_draft  add column if not exists hero_title text;
alter table settings_public add column if not exists hero_title text;

alter table settings_draft  add column if not exists hero_subtext text;
alter table settings_public add column if not exists hero_subtext text;

alter table settings_draft  add column if not exists hero_title_size text default 'medium';
alter table settings_public add column if not exists hero_title_size text;

alter table settings_draft  add column if not exists hero_subtext_size text default 'medium';
alter table settings_public add column if not exists hero_subtext_size text;

alter table settings_draft  add column if not exists hero_badge_size text default 'medium';
alter table settings_public add column if not exists hero_badge_size text;

alter table settings_draft  add column if not exists hero_title_font_size text;
alter table settings_public add column if not exists hero_title_font_size text;

alter table settings_draft  add column if not exists hero_subtext_font_size text;
alter table settings_public add column if not exists hero_subtext_font_size text;

alter table settings_draft  add column if not exists hero_badge_font_size text;
alter table settings_public add column if not exists hero_badge_font_size text;

alter table settings_draft  add column if not exists hero_image_url text;
alter table settings_public add column if not exists hero_image_url text;

alter table settings_draft  add column if not exists featured_video_url text;
alter table settings_public add column if not exists featured_video_url text;

alter table settings_draft  add column if not exists who_title text;
alter table settings_public add column if not exists who_title text;

alter table settings_draft  add column if not exists who_body text;
alter table settings_public add column if not exists who_body text;

alter table settings_draft  add column if not exists who_cta_label text;
alter table settings_public add column if not exists who_cta_label text;

alter table settings_draft  add column if not exists who_cta_url text;
alter table settings_public add column if not exists who_cta_url text;

alter table settings_draft  add column if not exists who_image_url text;
alter table settings_public add column if not exists who_image_url text;

-- =====================================================================
-- 6. About page content
-- =====================================================================
alter table settings_draft  add column if not exists about_title text;
alter table settings_public add column if not exists about_title text;

alter table settings_draft  add column if not exists about_body text;
alter table settings_public add column if not exists about_body text;

alter table settings_draft  add column if not exists about_mission_title text;
alter table settings_public add column if not exists about_mission_title text;

alter table settings_draft  add column if not exists about_mission_body text;
alter table settings_public add column if not exists about_mission_body text;

alter table settings_draft  add column if not exists about_team_intro text;
alter table settings_public add column if not exists about_team_intro text;

alter table settings_draft  add column if not exists about_team jsonb default '[]'::jsonb;
alter table settings_public add column if not exists about_team jsonb default '[]'::jsonb;

alter table settings_draft  add column if not exists people_profiles jsonb default '[]'::jsonb;
alter table settings_public add column if not exists people_profiles jsonb default '[]'::jsonb;

-- =====================================================================
-- 7. Events page content
-- =====================================================================
alter table settings_draft  add column if not exists events_title text;
alter table settings_public add column if not exists events_title text;

alter table settings_draft  add column if not exists events_intro text;
alter table settings_public add column if not exists events_intro text;

alter table settings_draft  add column if not exists events_upcoming jsonb default '[]'::jsonb;
alter table settings_public add column if not exists events_upcoming jsonb default '[]'::jsonb;

alter table settings_draft  add column if not exists events_past jsonb default '[]'::jsonb;
alter table settings_public add column if not exists events_past jsonb default '[]'::jsonb;

-- =====================================================================
-- 8. Media page content
-- =====================================================================
alter table settings_draft  add column if not exists media_title text;
alter table settings_public add column if not exists media_title text;

alter table settings_draft  add column if not exists media_intro text;
alter table settings_public add column if not exists media_intro text;

alter table settings_draft  add column if not exists media_sections jsonb default '[]'::jsonb;
alter table settings_public add column if not exists media_sections jsonb default '[]'::jsonb;

-- =====================================================================
-- 9. Merch page content
-- =====================================================================
alter table settings_draft  add column if not exists merch_title text;
alter table settings_public add column if not exists merch_title text;

alter table settings_draft  add column if not exists merch_intro text;
alter table settings_public add column if not exists merch_intro text;

alter table settings_draft  add column if not exists merch_items jsonb default '[]'::jsonb;
alter table settings_public add column if not exists merch_items jsonb default '[]'::jsonb;

-- =====================================================================
-- 10. Contact page content
-- =====================================================================
alter table settings_draft  add column if not exists contact_title text;
alter table settings_public add column if not exists contact_title text;

alter table settings_draft  add column if not exists contact_intro text;
alter table settings_public add column if not exists contact_intro text;

alter table settings_draft  add column if not exists contact_cards jsonb default '[]'::jsonb;
alter table settings_public add column if not exists contact_cards jsonb default '[]'::jsonb;

-- =====================================================================
-- 11. Lock table for editing coordination
-- =====================================================================
create table if not exists settings_lock (
  id integer primary key,
  holder_email text,
  acquired_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active_version_id uuid,
  source_version_id uuid,
  auto_saved_version_id uuid
);

alter table settings_lock add column if not exists holder_email text;
alter table settings_lock add column if not exists acquired_at timestamptz;
alter table settings_lock add column if not exists expires_at timestamptz;
alter table settings_lock add column if not exists created_at timestamptz not null default now();
alter table settings_lock alter column created_at set default now();
alter table settings_lock add column if not exists updated_at timestamptz not null default now();
alter table settings_lock alter column updated_at set default now();
alter table settings_lock add column if not exists active_version_id uuid;
alter table settings_lock add column if not exists source_version_id uuid;
alter table settings_lock add column if not exists auto_saved_version_id uuid;

-- =====================================================================
-- 12. Version history
-- =====================================================================
create table if not exists settings_versions (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('draft', 'live')),
  label text,
  author_email text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  note text,
  kind text not null default 'draft',
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  is_default boolean not null default false
);

alter table settings_versions add column if not exists stage text;
alter table settings_versions add column if not exists label text;
alter table settings_versions add column if not exists author_email text;
alter table settings_versions add column if not exists data jsonb default '{}'::jsonb;
alter table settings_versions alter column data set default '{}'::jsonb;
alter table settings_versions add column if not exists status text default 'active';
alter table settings_versions alter column status set default 'active';
alter table settings_versions add column if not exists created_at timestamptz not null default now();
alter table settings_versions alter column created_at set default now();
alter table settings_versions add column if not exists note text;
alter table settings_versions add column if not exists kind text default 'draft';
alter table settings_versions alter column kind set default 'draft';
alter table settings_versions add column if not exists updated_at timestamptz not null default now();
alter table settings_versions alter column updated_at set default now();
alter table settings_versions add column if not exists published_at timestamptz;
alter table settings_versions add column if not exists is_default boolean default false;
alter table settings_versions alter column is_default set default false;

create index if not exists idx_settings_versions_created on settings_versions (created_at desc);
create index if not exists idx_settings_versions_stage on settings_versions (stage);
create index if not exists idx_settings_versions_kind on settings_versions (kind);
create index if not exists idx_settings_versions_status on settings_versions (status);

-- =====================================================================
-- 13. Deployment scheduling
-- =====================================================================
create table if not exists settings_deployments (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references settings_versions(id) on delete cascade,
  fallback_snapshot_id uuid references settings_versions(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  cancelled_at timestamptz,
  cancelled_by text,
  override_reason text,
  activated_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_settings_deployments_start on settings_deployments (start_at);
create index if not exists idx_settings_deployments_status on settings_deployments (status);

alter table settings_deployments
  add column if not exists snapshot_id uuid references settings_versions(id) on delete cascade,
  add column if not exists fallback_snapshot_id uuid references settings_versions(id) on delete set null,
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz,
  add column if not exists status text default 'scheduled',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists override_reason text,
  add column if not exists activated_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table settings_deployments alter column status set default 'scheduled';
alter table settings_deployments alter column created_at set default now();
alter table settings_deployments alter column updated_at set default now();

update settings_deployments set status = 'scheduled' where status is null;
update settings_deployments set created_at = coalesce(created_at, now());
update settings_deployments set updated_at = coalesce(updated_at, created_at, now());

do $$
begin
  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings_deployments'
         and column_name = 'snapshot_id'
     )
     and not exists (select 1 from settings_deployments where snapshot_id is null) then
    alter table settings_deployments alter column snapshot_id set not null;
  end if;
  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings_deployments'
         and column_name = 'start_at'
     )
     and not exists (select 1 from settings_deployments where start_at is null) then
    alter table settings_deployments alter column start_at set not null;
  end if;
  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings_deployments'
         and column_name = 'status'
     )
     and not exists (select 1 from settings_deployments where status is null) then
    alter table settings_deployments alter column status set not null;
  end if;
  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings_deployments'
         and column_name = 'created_at'
     )
     and not exists (select 1 from settings_deployments where created_at is null) then
    alter table settings_deployments alter column created_at set not null;
  end if;
  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'settings_deployments'
         and column_name = 'updated_at'
     )
     and not exists (select 1 from settings_deployments where updated_at is null) then
    alter table settings_deployments alter column updated_at set not null;
  end if;
end
$$;

-- =====================================================================
-- 14. Contact form responses
-- =====================================================================
create table if not exists contact_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  name text,
  email text,
  message text,
  responded boolean default false,
  responded_at timestamptz,
  responded_by text,
  notes text,
  delivery_status text,
  delivery_error text,
  meta jsonb
);

alter table contact_responses add column if not exists created_at timestamptz not null default now();
alter table contact_responses alter column created_at set default now();
alter table contact_responses add column if not exists updated_at timestamptz default now();
alter table contact_responses alter column updated_at set default now();
alter table contact_responses add column if not exists name text;
alter table contact_responses add column if not exists email text;
alter table contact_responses add column if not exists message text;
alter table contact_responses add column if not exists responded boolean default false;
alter table contact_responses alter column responded set default false;
alter table contact_responses add column if not exists responded_at timestamptz;
alter table contact_responses add column if not exists responded_by text;
alter table contact_responses add column if not exists notes text;
alter table contact_responses add column if not exists delivery_status text;
alter table contact_responses add column if not exists delivery_error text;
alter table contact_responses add column if not exists meta jsonb;

create index if not exists idx_contact_responses_created on contact_responses (created_at desc);
create index if not exists idx_contact_responses_email on contact_responses (email);
create index if not exists idx_contact_responses_status on contact_responses (responded, delivery_status);

-- =====================================================================
-- 15. Convenience note
-- =====================================================================
-- Tables created/ensured here: settings_draft, settings_public, settings_lock,
-- settings_versions, settings_deployments, contact_responses. Run 002_admin_actions.sql
-- next to provision the admin_actions audit log.
