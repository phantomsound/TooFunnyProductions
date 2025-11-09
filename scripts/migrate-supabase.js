#!/usr/bin/env node

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const defaultDocsPath = path.resolve(__dirname, '../backend/docs');
const defaultUnsupportedExtensions = ['pg_net'];
const supabaseRoleDefinitions = [
  { name: 'anon', attributes: 'NOLOGIN' },
  { name: 'authenticated', attributes: 'NOLOGIN' },
  { name: 'service_role', attributes: 'NOLOGIN' }
];

const unsupportedExtensionCleanups = {
  pg_net: [
    {
      description: 'extensions.grant_pg_net_access() helper function',
      pattern: buildFunctionRemovalRegex('extensions.grant_pg_net_access')
    },
    {
      description: 'extensions.grant_pg_net_access() helper body (orphaned)',
      pattern: buildStatementRemovalRegex(
        'IF\\s+EXISTS[\\s\\S]+?extname\\s*=\\s*\'pg_net\'[\\s\\S]+?END;\\s*(\\$[^$\\n]*\\$);\\s*'
      )
    },
    {
      description: 'COMMENT ON FUNCTION extensions.grant_pg_net_access()',
      pattern: buildStatementRemovalRegex(
        'COMMENT\\s+ON\\s+FUNCTION\\s+extensions\\.grant_pg_net_access\\(\\)[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'issue_pg_net_access event trigger',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?EVENT\\s+TRIGGER\\s+issue_pg_net_access[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'COMMENT ON EVENT TRIGGER issue_pg_net_access',
      pattern: buildStatementRemovalRegex(
        'COMMENT\\s+ON\\s+EVENT\\s+TRIGGER\\s+issue_pg_net_access[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'supabase_functions.http_request() trigger helper',
      pattern: buildFunctionRemovalRegex('supabase_functions.http_request')
    }
  ],
  pg_graphql: [
    {
      description: 'extensions.grant_pg_graphql_access() helper',
      pattern: buildFunctionRemovalRegex('extensions.grant_pg_graphql_access')
    },
    {
      description: 'COMMENT ON FUNCTION extensions.grant_pg_graphql_access()',
      pattern: buildStatementRemovalRegex(
        'COMMENT\\s+ON\\s+FUNCTION\\s+extensions\\.grant_pg_graphql_access\\(\\)[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'extensions.set_graphql_placeholder() helper',
      pattern: buildFunctionRemovalRegex('extensions.set_graphql_placeholder')
    },
    {
      description: 'COMMENT ON FUNCTION extensions.set_graphql_placeholder()',
      pattern: buildStatementRemovalRegex(
        'COMMENT\\s+ON\\s+FUNCTION\\s+extensions\\.set_graphql_placeholder\\(\\)[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'issue_pg_graphql_access event trigger',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?EVENT\\s+TRIGGER\\s+issue_pg_graphql_access[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'issue_graphql_placeholder event trigger',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?EVENT\\s+TRIGGER\\s+issue_graphql_placeholder[\\s\\S]+?;\\s*'
      )
    }
  ],
  pg_graphql: [
    {
      description: 'extensions.grant_pg_graphql_access() helper',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+extensions\\.grant_pg_graphql_access\\(\\)[\\s\\S]+?\\$\\$[\\s\\S]+?\\$\\$;\\s*'
      )
    },
    {
      description: 'COMMENT ON FUNCTION extensions.grant_pg_graphql_access()',
      pattern: buildStatementRemovalRegex(
        'COMMENT\\s+ON\\s+FUNCTION\\s+extensions\\.grant_pg_graphql_access\\(\\)[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'extensions.set_graphql_placeholder() helper',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+extensions\\.set_graphql_placeholder\\(\\)[\\s\\S]+?\\$\\$[\\s\\S]+?\\$\\$;\\s*'
      )
    },
    {
      description: 'COMMENT ON FUNCTION extensions.set_graphql_placeholder()',
      pattern: buildStatementRemovalRegex(
        'COMMENT\\s+ON\\s+FUNCTION\\s+extensions\\.set_graphql_placeholder\\(\\)[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'issue_pg_graphql_access event trigger',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?EVENT\\s+TRIGGER\\s+issue_pg_graphql_access[\\s\\S]+?;\\s*'
      )
    },
    {
      description: 'issue_graphql_placeholder event trigger',
      pattern: buildStatementRemovalRegex(
        'CREATE\\s+(?:OR\\s+REPLACE\\s+)?EVENT\\s+TRIGGER\\s+issue_graphql_placeholder[\\s\\S]+?;\\s*'
      )
    }
  ]
};
const recommendedExports = [
  { table: 'settings_draft', file: '001_settings_draft.sql' },
  { table: 'settings_public', file: '002_settings_public.sql' },
  { table: 'settings_lock', file: '003_settings_lock.sql' },
  { table: 'settings_versions', file: '004_settings_versions.sql' },
  { table: 'settings_deployments', file: '005_settings_deployments.sql' },
  { table: 'admin_actions', file: '006_admin_actions.sql' },
  { table: 'contact_responses', file: '007_contact_responses.sql' }
];

function buildStatementRemovalRegex(statementPattern) {
  return new RegExp(`^\\s*(?:--[^\n]*\n\s*)*${statementPattern}`, 'gmi');
}

function buildFunctionRemovalRegex(qualifiedName) {
  const escapedName = qualifiedName
    .split('.')
    .map((part) => escapeRegExp(part))
    .join('\\.');
  return buildStatementRemovalRegex(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${escapedName}\\s*\\([^)]*\\)[\\s\\S]+?AS\\s+(\\$[^$\\n]*\\$)[\\s\\S]+?\\1;\\s*`
  );
}

async function main() {
  console.log('Supabase → Local PostgreSQL migration orchestrator');

  await ensureBinary('pg_dump');
  await ensureBinary('psql');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const supabaseUrl = await ask(rl, 'Supabase connection string (postgresql://user:password@host:port/database?sslmode=require): ');
    if (!supabaseUrl) {
      throw new Error('Supabase connection string is required.');
    }

    const localDbUrl = await ask(rl, 'Local target database connection string (postgresql://user:password@host:port/database): ');
    if (!localDbUrl) {
      throw new Error('Local database connection string is required.');
    }

    const adminDbDefault = 'postgres';
    const adminDbName = await ask(rl, `Local admin database for CREATE DATABASE [${adminDbDefault}]: `) || adminDbDefault;

    const docsPathAnswer = await ask(rl, `Docs directory that holds schema/data/tests [${defaultDocsPath}]: `);
    const docsPath = docsPathAnswer ? path.resolve(docsPathAnswer) : defaultDocsPath;

    await fs.mkdir(docsPath, { recursive: true });
    const schemaDir = path.join(docsPath, 'schema');
    const dataDir = path.join(docsPath, 'data');
    const testsDir = path.join(docsPath, 'tests');
    await Promise.all([
      fs.mkdir(schemaDir, { recursive: true }),
      fs.mkdir(dataDir, { recursive: true }),
      fs.mkdir(testsDir, { recursive: true })
    ]);

    console.log('\nWorking directories:');
    console.log(`  schema → ${schemaDir}`);
    console.log(`  data   → ${dataDir}`);
    console.log(`  tests  → ${testsDir}`);

    const schemaDumpPath = path.join(schemaDir, 'supabase_schema.sql');

    if (await confirm(rl, `Export Supabase schema to ${schemaDumpPath}? [Y/n]: `, true)) {
      await exportSchema({ supabaseUrl, schemaDumpPath });
    } else {
      console.log('Skipping schema export.');
    }

    const localDbUrlObj = new URL(localDbUrl);
    const localDbName = decodeURIComponent(localDbUrlObj.pathname.replace(/^\//, ''));
    const adminUrlObj = new URL(localDbUrl);
    adminUrlObj.pathname = `/${adminDbName}`;
    const localAdminUrl = adminUrlObj.toString();

    if (await confirm(rl, `Ensure local database "${localDbName}" exists (will create if missing)? [Y/n]: `, true)) {
      await ensureDatabasePrepared({ rl, localAdminUrl, localDbName });
    }

    if (await confirm(rl, `Apply schema dump to local database ${summariseConnection(localDbUrl)}? [Y/n]: `, true)) {
      await applySchema({ localDbUrl, schemaDumpPath });
    }

    if (await confirm(rl, 'Run helper DDL scripts (settings-columns, contact-responses, admin-actions)? [Y/n]: ', true)) {
      await runHelperDdls({ localDbUrl, docsPath });
    }

    let dataExports = recommendedExports;
    if (await confirm(rl, 'Use recommended Supabase table export list? [Y/n]: ', true) === false) {
      const listAnswer = await ask(rl, 'Enter comma-separated table names to export (will auto-number files): ');
      const customTables = listAnswer
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (customTables.length === 0) {
        console.log('No tables provided; data export will be skipped.');
        dataExports = [];
      } else {
        dataExports = customTables.map((table, index) => ({
          table,
          file: `${String(index + 1).padStart(3, '0')}_${table}.sql`
        }));
        console.log('Using custom export list:');
        dataExports.forEach(({ table, file }) => console.log(`  ${table} → ${file}`));
      }
    } else {
      console.log('Using recommended export list:');
      dataExports.forEach(({ table, file }) => console.log(`  ${table} → ${file}`));
    }

    if (dataExports.length > 0 && await confirm(rl, 'Export data from Supabase now? [Y/n]: ', true)) {
      await exportDataTables({ supabaseUrl, dataDir, exports: dataExports });
    }

    if (dataExports.length > 0 && await confirm(rl, 'Import data into local database now? [Y/n]: ', true)) {
      await importDataTables({ localDbUrl, dataDir, exports: dataExports });
    }

    if (await confirm(rl, 'Rewrite stored Supabase URLs to a new host? [y/N]: ', false)) {
      const searchDefault = 'https://<project>.supabase.co';
      const searchValue = await ask(rl, `Substring to replace [${searchDefault}]: `) || searchDefault;
      if (searchValue === searchDefault) {
        console.warn('Using placeholder search substring; update it to your actual Supabase domain if needed.');
      }
      const replaceValue = await ask(rl, 'Replacement substring (e.g., https://media.example.com): ');
      if (!replaceValue) {
        console.warn('Replacement value is empty; skipping rewrite step.');
      } else {
        const schemaAnswer = await ask(rl, 'Target schemas (comma-separated) [public]: ');
        const schemas = schemaAnswer
          ? schemaAnswer.split(',').map((value) => value.trim()).filter(Boolean)
          : ['public'];
        await rewriteStoredReferences({ localDbUrl, searchValue, replaceValue, schemas });
      }
    }

    if (await confirm(rl, 'Run fullChecker.sql against Supabase and local for verification? [y/N]: ', false)) {
      await runFullChecker({ supabaseUrl, localDbUrl, docsPath });
    }

    console.log('\nMigration workflow completed. Review any warnings above and verify application behaviour.');
  } finally {
    rl.close();
  }
}

async function ensureBinary(binary) {
  try {
    await runCommand(binary, ['--version'], { showCommand: false });
  } catch (error) {
    throw new Error(`${binary} is not available on the PATH. Install the PostgreSQL client tools and ensure ${binary} is reachable.\n${error.message}`);
  }
}

async function exportSchema({ supabaseUrl, schemaDumpPath }) {
  console.log(`\nExporting Supabase schema to ${schemaDumpPath}`);
  const args = [
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--file',
    schemaDumpPath,
    '--dbname',
    supabaseUrl
  ];
  await runCommand('pg_dump', args, { redactArgs: [args.length - 1] });
}

async function ensureDatabasePrepared({ rl, localAdminUrl, localDbName }) {
  console.log(`\nChecking for local database "${localDbName}"`);
  const existsArgs = [
    '--tuples-only',
    '--no-align',
    '--dbname',
    localAdminUrl,
    '--command',
    `SELECT 1 FROM pg_database WHERE datname = '${escapeSqlLiteral(localDbName)}';`
  ];
  const result = await runCommand('psql', existsArgs, {
    redactArgs: [existsArgs.indexOf(localAdminUrl)],
    captureStdout: true
  });
  const hasDatabase = result.stdout.trim().startsWith('1');
  if (hasDatabase) {
    console.log(`Database "${localDbName}" already exists.`);
    const shouldRecreate = await confirm(
      rl,
      `Database "${localDbName}" already exists. Drop and recreate it? [y/N]: `,
      false
    );
    if (!shouldRecreate) {
      console.warn('Keeping existing database. If previous schema objects remain, CREATE statements may fail.');
      return;
    }

    await dropDatabase(localAdminUrl, localDbName);
    await createDatabase(localAdminUrl, localDbName);
    return;
  }

  console.log(`Database "${localDbName}" not found. Creating...`);
  await createDatabase(localAdminUrl, localDbName);
}

async function dropDatabase(localAdminUrl, localDbName) {
  console.log(`Dropping database "${localDbName}"...`);
  const terminateArgs = [
    '--dbname',
    localAdminUrl,
    '--command',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${escapeSqlLiteral(localDbName)}' AND pid <> pg_backend_pid();`
  ];
  await runCommand('psql', terminateArgs, { redactArgs: [terminateArgs.indexOf(localAdminUrl)] });

  const dropArgs = [
    '--dbname',
    localAdminUrl,
    '--command',
    `DROP DATABASE "${localDbName}";`
  ];
  await runCommand('psql', dropArgs, { redactArgs: [dropArgs.indexOf(localAdminUrl)] });
}

async function createDatabase(localAdminUrl, localDbName) {
  console.log(`Creating database "${localDbName}"...`);
  const createArgs = [
    '--dbname',
    localAdminUrl,
    '--command',
    `CREATE DATABASE "${localDbName}";`
  ];
  await runCommand('psql', createArgs, { redactArgs: [createArgs.indexOf(localAdminUrl)] });
}

async function applySchema({ localDbUrl, schemaDumpPath }) {
  console.log(`\nApplying schema ${schemaDumpPath} to ${summariseConnection(localDbUrl)}`);
  await ensureSupabaseRoles({ localDbUrl });
  const schemaToApply = await prepareSchemaFile(schemaDumpPath, { localDbUrl });
  if (schemaToApply !== schemaDumpPath) {
    console.warn(`Using sanitized schema file without unsupported extensions: ${schemaToApply}`);
    console.warn('Tip: Update your checked-in schema dump to remove these extension statements so future runs match.');
  }
  const args = [
    '--set',
    'ON_ERROR_STOP=on',
    '--dbname',
    localDbUrl,
    '--file',
    schemaToApply
  ];
  await runCommand('psql', args, { redactArgs: [args.indexOf(localDbUrl)] });
}

async function prepareSchemaFile(schemaDumpPath, { localDbUrl } = {}) {
  let contents;
  try {
    contents = await fs.readFile(schemaDumpPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read schema dump at ${schemaDumpPath}: ${error.message}`);
  }

  const { unsupportedExtensions, reasons } = await determineUnsupportedExtensions({
    schemaContents: contents,
    localDbUrl
  });

  let sanitized = contents;
  let modified = false;

  for (const ext of unsupportedExtensions) {
    const extRegex = `["']?${escapeRegExp(ext)}["']?`;
    const patterns = [
      new RegExp(`^\\s*CREATE\\s+EXTENSION\\b[^;\n]*?${extRegex}[^;\n]*;\\s*$`, 'gmi'),
      new RegExp(`^\\s*COMMENT\\s+ON\\s+EXTENSION\\b[^;\n]*?${extRegex}[^;\n]*;\\s*$`, 'gmi'),
      new RegExp(`^\\s*ALTER\\s+EXTENSION\\b[^;\n]*?${extRegex}[^;\n]*;\\s*$`, 'gmi')
    ];

    let removedForExtension = false;
    for (const pattern of patterns) {
      const next = sanitized.replace(pattern, () => {
        removedForExtension = true;
        return '';
      });
      sanitized = next;
    }

    const cleanupRules = unsupportedExtensionCleanups[ext] || [];
    for (const rule of cleanupRules) {
      let localRemoved = 0;
      sanitized = sanitized.replace(rule.pattern, () => {
        localRemoved += 1;
        return '';
      });
      if (localRemoved > 0) {
        removedForExtension = true;
        modified = true;
        console.warn(`Skipping ${rule.description} because it depends on unsupported extension "${ext}".`);
      }
    }

    if (removedForExtension) {
      modified = true;
      const reason = reasons.get(ext);
      if (reason) {
        console.warn(`Skipping statements for unsupported PostgreSQL extension "${ext}" (${reason}).`);
      } else {
        console.warn(`Skipping statements for unsupported PostgreSQL extension "${ext}".`);
      }
    }
  }

  if (!modified) {
    return schemaDumpPath;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toofunny-schema-'));
  const sanitizedPath = path.join(tempDir, path.basename(schemaDumpPath));
  await fs.writeFile(sanitizedPath, sanitized, 'utf8');
  return sanitizedPath;
}

async function ensureSupabaseRoles({ localDbUrl }) {
  if (!localDbUrl) {
    return;
  }

  const roleStatements = supabaseRoleDefinitions
    .map(({ name, attributes }) => {
      const attrClause = attributes ? ` ${attributes}` : '';
      return `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${escapeSqlLiteral(name)}') THEN CREATE ROLE "${name}"${attrClause}; END IF;`;
    })
    .join('\n  ');

  if (!roleStatements) {
    return;
  }

  console.log('Ensuring standard Supabase roles exist locally.');
  const args = [
    '--dbname',
    localDbUrl,
    '--command',
    `DO $$\nBEGIN\n  ${roleStatements}\nEND;\n$$;`
  ];
  await runCommand('psql', args, { redactArgs: [args.indexOf(localDbUrl)] });
}

async function determineUnsupportedExtensions({ schemaContents, localDbUrl }) {
  const declaredExtensions = extractExtensionNamesFromSchema(schemaContents);
  if (declaredExtensions.size === 0) {
    return { unsupportedExtensions: [], reasons: new Map() };
  }

  const reasons = new Map();
  for (const ext of defaultUnsupportedExtensions) {
    if (declaredExtensions.has(ext)) {
      reasons.set(ext, 'not supported by migration tooling');
    }
  }

  const candidates = [...declaredExtensions].filter((ext) => !reasons.has(ext));
  if (candidates.length > 0 && localDbUrl) {
    const availableExtensions = await listAvailableExtensions(localDbUrl);
    if (availableExtensions) {
      for (const ext of candidates) {
        if (!availableExtensions.has(ext)) {
          reasons.set(ext, 'not available on local server');
        }
      }
    }
  }

  return { unsupportedExtensions: [...reasons.keys()], reasons };
}

async function listAvailableExtensions(localDbUrl) {
  if (!localDbUrl) {
    return null;
  }

  const args = [
    '--tuples-only',
    '--no-align',
    '--dbname',
    localDbUrl,
    '--command',
    'SELECT name FROM pg_available_extensions;'
  ];

  try {
    const { stdout } = await runCommand('psql', args, {
      showCommand: false,
      captureStdout: true,
      redactArgs: [args.indexOf(localDbUrl)]
    });
    const names = stdout
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    return new Set(names);
  } catch (error) {
    console.warn('Unable to check available PostgreSQL extensions on the local server.');
    console.warn(error.message || error);
    return null;
  }
}

function extractExtensionNamesFromSchema(schemaContents) {
  const names = new Set();
  const regex = /CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+(["']?)([\w-]+)\1/gi;
  let match;
  while ((match = regex.exec(schemaContents)) !== null) {
    const name = match[2];
    if (name) {
      names.add(name.toLowerCase());
    }
  }
  return names;
}

async function runHelperDdls({ localDbUrl, docsPath }) {
  const scripts = [
    path.join(docsPath, 'settings-columns.sql'),
    path.join(docsPath, 'schema', 'contact-responses.sql'),
    path.join(docsPath, 'admin-actions.sql')
  ];
  for (const scriptPath of scripts) {
    await ensureFileExists(scriptPath);
    console.log(`\nApplying helper DDL ${scriptPath}`);
    const args = [
      '--set',
      'ON_ERROR_STOP=on',
      '--dbname',
      localDbUrl,
      '--file',
      scriptPath
    ];
    await runCommand('psql', args, { redactArgs: [args.indexOf(localDbUrl)] });
  }
}

async function exportDataTables({ supabaseUrl, dataDir, exports }) {
  for (const { table, file } of exports) {
    const outPath = path.join(dataDir, file);
    console.log(`\nExporting ${table} data to ${outPath}`);
    const args = [
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--table',
      `public.${table}`,
      '--file',
      outPath,
      '--dbname',
      supabaseUrl
    ];
    await runCommand('pg_dump', args, { redactArgs: [args.length - 1] });
  }
}

async function importDataTables({ localDbUrl, dataDir, exports }) {
  const importFiles = [];
  for (const item of exports) {
    const filePath = path.join(dataDir, item.file);
    if (await fileExists(filePath)) {
      importFiles.push(filePath);
    } else {
      console.warn(`Skipping ${filePath} (file not found).`);
    }
  }

  if (importFiles.length === 0) {
    console.warn('No data files found to import.');
    return;
  }

  for (const filePath of importFiles) {
    console.log(`\nImporting ${filePath} into ${summariseConnection(localDbUrl)}`);
    const args = [
      '--set',
      'ON_ERROR_STOP=on',
      '--single-transaction',
      '--dbname',
      localDbUrl,
      '--file',
      filePath
    ];
    await runCommand('psql', args, { redactArgs: [args.indexOf(localDbUrl)] });
  }
}

async function rewriteStoredReferences({ localDbUrl, searchValue, replaceValue, schemas }) {
  const trimmedSearch = (searchValue || '').trim();
  const trimmedReplace = (replaceValue || '').trim();

  if (!trimmedSearch) {
    console.warn('Search string is empty; skipping rewrite step.');
    return;
  }

  if (trimmedSearch === trimmedReplace) {
    console.warn('Search and replacement strings are identical; skipping rewrite step.');
    return;
  }

  const uniqueSchemas = Array.from(new Set((schemas || []).map((value) => value.trim()).filter(Boolean)));
  if (uniqueSchemas.length === 0) {
    uniqueSchemas.push('public');
  }

  console.log('\nRewriting stored references:');
  console.log(`  search → ${trimmedSearch}`);
  console.log(`  replace → ${trimmedReplace}`);
  console.log(`  schemas → ${uniqueSchemas.join(', ')}`);
  console.warn('  ⚠️ This will issue UPDATE statements across the selected schemas. Ensure you have a backup.');

  const schemaListValues = uniqueSchemas.map((schema) => `'${escapeSqlLiteral(schema)}'`);
  const schemaList = schemaListValues.length > 0 ? schemaListValues.join(', ') : `'public'`;

  const script = `DO $mig$
DECLARE
  v_search text := '${escapeSqlLiteral(trimmedSearch)}';
  v_replace text := '${escapeSqlLiteral(trimmedReplace)}';
  v_like text := '%' || v_search || '%';
  v_rowcount bigint;
  v_schema_list text[] := ARRAY[${schemaList}];
  rec record;
BEGIN
  IF v_search IS NULL OR v_search = '' THEN
    RAISE NOTICE 'Skipping rewrite: empty search value.';
    RETURN;
  END IF;

  IF v_search = v_replace THEN
    RAISE NOTICE 'Skipping rewrite: replacement matches search.';
    RETURN;
  END IF;

  FOR rec IN
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = ANY(v_schema_list)
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
  LOOP
    IF rec.data_type IN ('json', 'jsonb') THEN
      EXECUTE format(
        'UPDATE %I.%I SET %I = replace(%I::text, %L, %L)::%s WHERE %I::text LIKE %L',
        rec.table_schema,
        rec.table_name,
        rec.column_name,
        rec.column_name,
        v_search,
        v_replace,
        rec.data_type,
        rec.column_name,
        v_like
      );
    ELSE
      EXECUTE format(
        'UPDATE %I.%I SET %I = replace(%I, %L, %L) WHERE %I LIKE %L',
        rec.table_schema,
        rec.table_name,
        rec.column_name,
        rec.column_name,
        v_search,
        v_replace,
        rec.column_name,
        v_like
      );
    END IF;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
      RAISE NOTICE 'Updated %.% (column %): % rows',
        rec.table_schema,
        rec.table_name,
        rec.column_name,
        v_rowcount;
    END IF;
  END LOOP;
END
$mig$;`;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toofunny-rewrite-'));
  const scriptPath = path.join(tempDir, 'rewrite.sql');
  await fs.writeFile(scriptPath, script, 'utf8');

  const args = [
    '--set',
    'ON_ERROR_STOP=on',
    '--dbname',
    localDbUrl,
    '--file',
    scriptPath
  ];

  await runCommand('psql', args, { redactArgs: [args.indexOf(localDbUrl)] });
}

async function runFullChecker({ supabaseUrl, localDbUrl, docsPath }) {
  const checkerPath = path.join(docsPath, 'fullChecker.sql');
  await ensureFileExists(checkerPath);

  console.log('\nRunning fullChecker.sql against Supabase');
  const supabaseArgs = [
    '--set',
    'ON_ERROR_STOP=on',
    '--dbname',
    supabaseUrl,
    '--file',
    checkerPath
  ];
  await runCommand('psql', supabaseArgs, { redactArgs: [supabaseArgs.indexOf(supabaseUrl)] });

  console.log('\nRunning fullChecker.sql against local');
  const localArgs = [
    '--set',
    'ON_ERROR_STOP=on',
    '--dbname',
    localDbUrl,
    '--file',
    checkerPath
  ];
  await runCommand('psql', localArgs, { redactArgs: [localArgs.indexOf(localDbUrl)] });
}

async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function confirm(rl, question, defaultYes) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, question || `${suffix}: `);
  if (!answer) {
    return !!defaultYes;
  }
  const normalized = answer.toLowerCase();
  if (['y', 'yes'].includes(normalized)) {
    return true;
  }
  if (['n', 'no'].includes(normalized)) {
    return false;
  }
  return !!defaultYes;
}

function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    showCommand = true,
    redactArgs = [],
    captureStdout = false
  } = options;

  const printable = `${command} ${args.map((arg, index) => {
    if (redactArgs.includes(index)) {
      return '[REDACTED]';
    }
    return sanitizeArg(arg);
  }).join(' ')}`;

  if (showCommand) {
    console.log(`$ ${printable}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';

    if (captureStdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    } else {
      child.stdout.pipe(process.stdout);
    }
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}${stderr ? `\n${stderr}` : ''}`));
      }
    });
  });
}

function sanitizeArg(arg) {
  if (arg.startsWith('postgresql://')) {
    try {
      return summariseConnection(arg);
    } catch (_) {
      return '[postgresql://…]';
    }
  }
  return arg;
}

function summariseConnection(connectionString) {
  const url = new URL(connectionString);
  const user = url.username || '<user>';
  const host = url.hostname || '<host>';
  const port = url.port ? `:${url.port}` : '';
  const db = decodeURIComponent(url.pathname.replace(/^\//, '')) || '<database>';
  return `postgresql://${user}@${host}${port}/${db}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeSqlLiteral(value) {
  return String(value ?? '').replace(/'/g, "''");
}

main().catch((error) => {
  console.error('\nMigration script failed.');
  console.error(error.message || error);
  process.exitCode = 1;
});
