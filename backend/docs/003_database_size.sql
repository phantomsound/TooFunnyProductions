-- Create a helper function to expose database size to PostgREST/Supabase RPC.
create or replace function public.get_database_size()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;
