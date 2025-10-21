-- Run this in your Supabase SQL editor to ensure draft + live tables
-- support all fields used by the admin panel.

-- Core columns -----------------------------------------------------------
alter table settings_draft  add column if not exists footer_links jsonb default '[]'::jsonb;
alter table settings_public add column if not exists footer_links jsonb default '[]'::jsonb;

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

-- Admin session controls ------------------------------------------------
alter table settings_draft  add column if not exists session_timeout_minutes integer default 30;
alter table settings_public add column if not exists session_timeout_minutes integer;

-- Homepage spotlight ----------------------------------------------------
alter table settings_draft  add column if not exists who_title text;
alter table settings_public add column if not exists who_title text;
alter table settings_draft  add column if not exists who_body text;
alter table settings_public add column if not exists who_body text;
alter table settings_draft  add column if not exists who_cta_label text;
alter table settings_public add column if not exists who_cta_label text;
alter table settings_draft  add column if not exists who_cta_url text;
alter table settings_public add column if not exists who_cta_url text;

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

-- Housekeeping ----------------------------------------------------------
alter table settings_draft  add column if not exists updated_at timestamptz default now();
alter table settings_public add column if not exists updated_at timestamptz;

alter table settings_draft  add column if not exists published_at timestamptz;
alter table settings_public add column if not exists published_at timestamptz;
