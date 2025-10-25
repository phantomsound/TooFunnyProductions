-- ------------------------------------------------------------------
-- Run this in your Supabase SQL editor to ensure draft + live tables
-- support all fields used by the admin panel.
-- ------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Base table scaffolding -------------------------------------------------
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

alter table settings_draft  add column if not exists created_at timestamptz default now();
alter table settings_public add column if not exists created_at timestamptz default now();
alter table settings_draft  alter column created_at set default now();
alter table settings_public alter column created_at set default now();

alter table settings_draft  add column if not exists updated_at timestamptz default now();
alter table settings_public add column if not exists updated_at timestamptz;

alter table settings_draft  add column if not exists published_at timestamptz;
alter table settings_public add column if not exists published_at timestamptz;

-- Branding & SEO ---------------------------------------------------------
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

-- Theme backgrounds -----------------------------------------------------
alter table settings_draft  add column if not exists theme_bg text default '#111111';
alter table settings_public add column if not exists theme_bg text;

alter table settings_draft  add column if not exists header_bg text default '#000000';
alter table settings_public add column if not exists header_bg text;

alter table settings_draft  add column if not exists footer_bg text default '#000000';
alter table settings_public add column if not exists footer_bg text;

alter table settings_draft  add column if not exists theme_use_global boolean default true;
alter table settings_public add column if not exists theme_use_global boolean default true;

-- Admin session controls ------------------------------------------------
alter table settings_draft  add column if not exists session_timeout_minutes integer default 30;
alter table settings_public add column if not exists session_timeout_minutes integer;

-- Maintenance ------------------------------------------------------------
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

-- Homepage spotlight ----------------------------------------------------
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

-- About page ------------------------------------------------------------
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

-- Events page -----------------------------------------------------------
alter table settings_draft  add column if not exists events_title text;
alter table settings_public add column if not exists events_title text;
alter table settings_draft  add column if not exists events_intro text;
alter table settings_public add column if not exists events_intro text;
alter table settings_draft  add column if not exists events_upcoming jsonb default '[]'::jsonb;
alter table settings_public add column if not exists events_upcoming jsonb default '[]'::jsonb;
alter table settings_draft  add column if not exists events_past jsonb default '[]'::jsonb;
alter table settings_public add column if not exists events_past jsonb default '[]'::jsonb;

-- Media page ------------------------------------------------------------
alter table settings_draft  add column if not exists media_title text;
alter table settings_public add column if not exists media_title text;
alter table settings_draft  add column if not exists media_intro text;
alter table settings_public add column if not exists media_intro text;
alter table settings_draft  add column if not exists media_sections jsonb default '[]'::jsonb;
alter table settings_public add column if not exists media_sections jsonb default '[]'::jsonb;

-- Merch page ------------------------------------------------------------
alter table settings_draft  add column if not exists merch_title text;
alter table settings_public add column if not exists merch_title text;
alter table settings_draft  add column if not exists merch_intro text;
alter table settings_public add column if not exists merch_intro text;
alter table settings_draft  add column if not exists merch_items jsonb default '[]'::jsonb;
alter table settings_public add column if not exists merch_items jsonb default '[]'::jsonb;

-- Contact page ----------------------------------------------------------
alter table settings_draft  add column if not exists contact_title text;
alter table settings_public add column if not exists contact_title text;
alter table settings_draft  add column if not exists contact_intro text;
alter table settings_public add column if not exists contact_intro text;
alter table settings_draft  add column if not exists contact_cards jsonb default '[]'::jsonb;
alter table settings_public add column if not exists contact_cards jsonb default '[]'::jsonb;

-- Supporting tables ------------------------------------------------------
create table if not exists settings_lock (
  id integer primary key,
  holder_email text,
  acquired_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table settings_lock add column if not exists holder_email text;
alter table settings_lock add column if not exists acquired_at timestamptz;
alter table settings_lock add column if not exists expires_at timestamptz;
alter table settings_lock add column if not exists created_at timestamptz not null default now();
alter table settings_lock alter column created_at set default now();
alter table settings_lock add column if not exists updated_at timestamptz not null default now();
alter table settings_lock alter column updated_at set default now();

create table if not exists settings_versions (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('draft', 'live')),
  label text,
  author_email text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
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

create index if not exists idx_settings_versions_created on settings_versions (created_at desc);
create index if not exists idx_settings_versions_stage on settings_versions (stage);
