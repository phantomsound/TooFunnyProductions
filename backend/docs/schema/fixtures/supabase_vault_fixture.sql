-- Supabase Vault sample dump (schema + data)
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
CREATE SCHEMA vault;

--
-- Name: secrets; Type: TABLE; Schema: vault; Owner: postgres
CREATE TABLE vault.secrets (
    id uuid NOT NULL,
    name text NOT NULL
);

COMMENT ON TABLE vault.secrets IS 'Secrets managed by Supabase Vault extension.';
COMMENT ON COLUMN vault.secrets.name IS 'Label for the secret record.';

ALTER TABLE vault.secrets OWNER TO postgres;

COPY vault.secrets (id, name) FROM stdin;
00000000-0000-0000-0000-000000000000	first-secret
\.
