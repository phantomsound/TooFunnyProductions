const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { prepareSchemaFile } = require('./migrate-supabase');

test('prepareSchemaFile strips meta-commands and unsupported Supabase extensions', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-supabase-test-'));
  const schemaPath = path.join(tempDir, 'schema.sql');

  const schemaContents = `-- Sample dump with psql directives and Supabase extras\n\\connect source_db\n\\ir seed.sql\nCREATE EXTENSION supabase_vault;\nCREATE EXTENSION PG_GRAPHQL;\nCREATE SCHEMA vault;\nCREATE TABLE vault.secrets(id int);\nCOPY vault.secrets (id) FROM stdin;\n1\n\\.\nCREATE SCHEMA graphql;\nCREATE TABLE graphql.types(id int);\nCOMMENT ON SCHEMA graphql IS 'GraphQL schema';\nCOPY graphql.types (id) FROM stdin;\n1\n\\.\nCREATE TABLE public.keep_me(id int);\n`;

  await fs.writeFile(schemaPath, schemaContents, 'utf8');

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  let sanitizedPath;
  try {
    sanitizedPath = await prepareSchemaFile(schemaPath, {});
  } finally {
    console.warn = originalWarn;
  }

  const sanitized = await fs.readFile(sanitizedPath, 'utf8');

  assert.notStrictEqual(
    sanitizedPath,
    schemaPath,
    'sanitized schema should be written to a temporary file when modifications occur'
  );
  assert(
    warnings.some((message) => message.includes('Stripped leading psql meta-commands')),
    'meta-command stripping should emit a warning'
  );
  assert(
    !/^[\s]*\\connect/m.test(sanitized) && !/^[\s]*\\ir/m.test(sanitized),
    'psql meta-commands should be removed from the sanitized output'
  );
  assert(
    !/supabase_vault/i.test(sanitized) && !/vault\./i.test(sanitized),
    'supabase_vault extension objects should be stripped'
  );
  assert(
    !/pg_graphql/i.test(sanitized) && !/graphql\./i.test(sanitized),
    'pg_graphql extension objects should be stripped'
  );
  assert(/CREATE TABLE public.keep_me/i.test(sanitized), 'unrelated objects should remain');
});
