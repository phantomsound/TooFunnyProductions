-- contact-responses.sql
-- ------------------------------------------------------------------
-- Ensures the contact_responses table used by the contact form exists
-- with all expected columns, defaults, and helpful indexes. Run this
-- inside Supabase (or your local PostgreSQL instance) before migrating
-- data.
-- ------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists contact_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  email text not null,
  message text not null,
  responded boolean not null default false,
  responded_at timestamptz,
  responded_by text,
  notes text,
  delivery_status text not null default 'pending',
  delivery_error text,
  meta jsonb not null default '{}'::jsonb
);

alter table contact_responses
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists name text not null,
  add column if not exists email text not null,
  add column if not exists message text not null,
  add column if not exists responded boolean not null default false,
  add column if not exists responded_at timestamptz,
  add column if not exists responded_by text,
  add column if not exists notes text,
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_error text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table contact_responses alter column responded set default false;
alter table contact_responses alter column delivery_status set default 'pending';
alter table contact_responses alter column meta set default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contact_responses_delivery_status_chk'
      and conrelid = 'contact_responses'::regclass
  ) then
    alter table contact_responses
      add constraint contact_responses_delivery_status_chk
      check (delivery_status in ('pending', 'sent', 'failed', 'skipped'));
  end if;
end
$$;

create index if not exists idx_contact_responses_created_at on contact_responses (created_at desc);
create index if not exists idx_contact_responses_email on contact_responses (lower(email));
create index if not exists idx_contact_responses_responded on contact_responses (responded, created_at desc);
