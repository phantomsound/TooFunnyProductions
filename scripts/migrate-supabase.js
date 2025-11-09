#!/usr/bin/env node

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const defaultDocsPath = path.resolve(__dirname, '../backend/docs');
const unsupportedExtensions = ['pg_net'];
const recommendedExports = [
  { table: 'settings_draft', file: '001_settings_draft.sql' },
  { table: 'settings_public', file: '002_settings_public.sql' },
  { table: 'settings_lock', file: '003_settings_lock.sql' },
  { table: 'settings_versions', file: '004_settings_versions.sql' },
  { table: 'settings_deployments', file: '005_settings_deployments.sql' },
  { table: 'admin_actions', file: '006_admin_actions.sql' },
  { table: 'contact_responses', file: '007_contact_responses.sql' }
];

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
      await ensureDatabaseExists(localAdminUrl, localDbName);
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

async function ensureDatabaseExists(localAdminUrl, localDbName) {
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
    return;
  }

  console.log(`Database "${localDbName}" not found. Creating...`);
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
  const schemaToApply = await prepareSchemaFile(schemaDumpPath);
  if (schemaToApply !== schemaDumpPath) {
    console.warn(`Using sanitized schema file without unsupported extensions: ${schemaToApply}`);
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

async function prepareSchemaFile(schemaDumpPath) {
  let contents;
  try {
    contents = await fs.readFile(schemaDumpPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read schema dump at ${schemaDumpPath}: ${error.message}`);
  }

  let sanitized = contents;
  let modified = false;

  for (const ext of unsupportedExtensions) {
    const extRegex = `["']?${escapeRegExp(ext)}["']?`;
    const patterns = [
      new RegExp(`^\\s*CREATE\\s+EXTENSION[\\s\\S]*?${extRegex}[\\s\\S]*?;\\s*$`, 'gmi'),
      new RegExp(`^\\s*COMMENT\\s+ON\\s+EXTENSION[\\s\\S]*?${extRegex}[\\s\\S]*?;\\s*$`, 'gmi'),
      new RegExp(`^\\s*ALTER\\s+EXTENSION[\\s\\S]*?${extRegex}[\\s\\S]*?;\\s*$`, 'gmi')
    ];

    let removedForExtension = false;
    for (const pattern of patterns) {
      const next = sanitized.replace(pattern, () => {
        removedForExtension = true;
        return '';
      });
      sanitized = next;
    }

    if (removedForExtension) {
      modified = true;
      console.warn(`Skipping statements for unsupported PostgreSQL extension "${ext}".`);
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
  return value.replace(/'/g, "''");
}

main().catch((error) => {
  console.error('\nMigration script failed.');
  console.error(error.message || error);
  process.exitCode = 1;
});
