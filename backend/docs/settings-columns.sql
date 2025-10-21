-- Run this in your Supabase SQL editor to ensure draft + live tables
-- support all fields used by the admin panel.

-- Core columns -----------------------------------------------------------
alter table settings_draft  add column if not exists footer_links jsonb default '[]'::jsonb;
alter table settings_public add column if not exists footer_links jsonb default '[]'::jsonb;

alter table settings_draft  add column if not exists contact_socials jsonb default '[]'::jsonb;
alter table settings_public add column if not exists contact_socials jsonb default '[]'::jsonb;

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

-- Housekeeping ----------------------------------------------------------
alter table settings_draft  add column if not exists updated_at timestamptz default now();
alter table settings_public add column if not exists updated_at timestamptz;

alter table settings_draft  add column if not exists published_at timestamptz;
alter table settings_public add column if not exists published_at timestamptz;
