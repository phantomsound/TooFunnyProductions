-- Sample dump with psql directives and Supabase extras
\connect source_db
\copy public.stub from '/tmp/stub.csv'
\ir seed.sql
\restrict
CREATE EXTENSION supabase_vault;
COMMENT ON EXTENSION supabase_vault IS 'Vault for Supabase secrets';
ALTER EXTENSION supabase_vault UPDATE;
CREATE EXTENSION PG_GRAPHQL;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets(id int);
COPY vault.secrets (id) FROM stdin;
1
\.
CREATE SCHEMA graphql;
CREATE TABLE graphql.types(id int);
COMMENT ON SCHEMA graphql IS 'GraphQL schema';
COPY graphql.types (id) FROM stdin;
1
\.
CREATE TABLE public.keep_me(id int);
