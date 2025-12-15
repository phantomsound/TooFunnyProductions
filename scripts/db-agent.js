#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');

const {
  ask,
  defaultDocsPath,
  ensureBinary,
  protectBackendEnv,
  exportSchema,
  ensureDatabasePrepared,
  dropDatabase,
  createDatabase,
  applySchema,
  runCommand,
  summariseConnection
} = require('./migrate-supabase');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = !args.supabaseUrl || !args.localUrl;
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  await ensureBinary('pg_dump');
  await ensureBinary('psql');

  const supabaseUrl = await requireSupabaseUrl(args, rl);
  const localDbUrl = await requireLocalUrl(args, rl);
  const adminDb = args.adminDb || 'postgres';
  const skipExport = !!args.skipExport;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultReport = path.join(defaultDocsPath, 'reports', `fdw-compare-${timestamp}.log`);
  const reportPath = path.resolve(args.reportPath || defaultReport);

  const restoreBackendEnv = await protectBackendEnv();

  try {
    await ensureDirectories();

    const schemaDumpPath = path.join(defaultDocsPath, 'schema', 'supabase_schema.sql');

    if (skipExport) {
      console.log(`Skipping Supabase export and reusing ${schemaDumpPath}`);
    } else {
      await exportSchema({ supabaseUrl, schemaDumpPath });
    }

    const { localDbName, localAdminUrl } = buildLocalDatabaseUrls(localDbUrl, adminDb);

    if (interactive) {
      await ensureDatabasePrepared({ rl, localAdminUrl, localDbName });
    } else {
      await recreateDatabase(localAdminUrl, localDbName);
    }

    await applySchema({ localDbUrl, schemaDumpPath });

    const compareResult = await runFdwComparison({ supabaseUrl, localDbUrl });
    const report = buildReport({
      supabaseUrl,
      localDbUrl,
      schemaDumpPath,
      reportPath,
      skipExport,
      ...compareResult
    });

    await writeReport(reportPath, report);
    console.log(report.summary);
    console.log(`\nDetailed report written to ${reportPath}`);
  } finally {
    rl?.close();
    await restoreBackendEnv();
  }
}

function parseArgs(argv) {
  const flags = {};
  for (const raw of argv) {
    const [key, ...rest] = raw.split('=');
    const value = rest.join('=');
    switch (key) {
      case '--supabase-url':
        flags.supabaseUrl = value || null;
        break;
      case '--local-url':
        flags.localUrl = value || null;
        break;
      case '--admin-db':
        flags.adminDb = value || null;
        break;
      case '--report-path':
        flags.reportPath = value || null;
        break;
      case '--skip-export':
        flags.skipExport = true;
        break;
      default:
        break;
    }
  }
  return flags;
}

async function requireSupabaseUrl(args, rl) {
  if (args.supabaseUrl) {
    return args.supabaseUrl;
  }
  if (!rl) {
    throw new Error('Supabase URL is required in non-interactive mode.');
  }
  const answer = await ask(
    rl,
    'Supabase connection string (postgresql://user:password@host:port/database?sslmode=require): '
  );
  if (!answer) {
    throw new Error('Supabase connection string is required.');
  }
  return answer;
}

async function requireLocalUrl(args, rl) {
  if (args.localUrl) {
    return args.localUrl;
  }
  if (!rl) {
    throw new Error('Local database URL is required in non-interactive mode.');
  }
  const answer = await ask(
    rl,
    'Local target database connection string (postgresql://user:password@host:port/database): '
  );
  if (!answer) {
    throw new Error('Local database connection string is required.');
  }
  return answer;
}

async function ensureDirectories() {
  const schemaDir = path.join(defaultDocsPath, 'schema');
  await fs.mkdir(schemaDir, { recursive: true });
  const reportsDir = path.join(defaultDocsPath, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
}

function buildLocalDatabaseUrls(localDbUrl, adminDb) {
  const localDbUrlObj = new URL(localDbUrl);
  const localDbName = decodeURIComponent(localDbUrlObj.pathname.replace(/^\//, ''));

  const adminUrlObj = new URL(localDbUrl);
  adminUrlObj.pathname = `/${adminDb}`;

  return { localDbName, localAdminUrl: adminUrlObj.toString() };
}

async function recreateDatabase(localAdminUrl, localDbName) {
  const existsArgs = [
    '--tuples-only',
    '--no-align',
    '--dbname',
    localAdminUrl,
    '--command',
    `SELECT 1 FROM pg_database WHERE datname = '${localDbName.replace(/'/g, "''")}';`
  ];
  const result = await runCommand('psql', existsArgs, {
    redactArgs: [existsArgs.indexOf(localAdminUrl)],
    captureStdout: true
  });
  const exists = result.stdout.trim().startsWith('1');

  if (exists) {
    await dropDatabase(localAdminUrl, localDbName);
  }
  await createDatabase(localAdminUrl, localDbName);
}

async function runFdwComparison({ supabaseUrl, localDbUrl }) {
  const supabase = new URL(supabaseUrl);

  const args = [
    '--tuples-only',
    '--no-align',
    '--quiet',
    '--pset',
    'footer=off',
    '--set',
    'ON_ERROR_STOP=on',
    '--set',
    `SUPABASE_HOST=${supabase.hostname}`,
    '--set',
    `SUPABASE_PORT=${supabase.port || '5432'}`,
    '--set',
    `SUPABASE_DB=${decodeURIComponent(supabase.pathname.replace(/^\//, ''))}`,
    '--set',
    `SUPABASE_USER=${supabase.username}`,
    '--set',
    `SUPABASE_PASSWORD=${supabase.password}`,
    '--dbname',
    localDbUrl,
    '--file',
    path.resolve(__dirname, '../backend/docs/tests/002_compare_supabase_fdw.sql')
  ];

  const result = await runCommand('psql', args, {
    redactArgs: buildRedactions(args, localDbUrl),
    captureStdout: true
  });

  const lines = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const rowDiffs = lines
    .filter((line) => /^\w+\|[-0-9]+\|[-0-9]+\|[-0-9]+$/.test(line))
    .map((line) => {
      const [tableName, localRows, supabaseRows, rowDiff] = line.split('|');
      return { tableName, localRows: Number(localRows), supabaseRows: Number(supabaseRows), rowDiff: Number(rowDiff) };
    });

  const hashDiffs = lines
    .filter((line) => /^\d+\|[a-f0-9]+\|[a-f0-9]+\|DIFFERS$/i.test(line))
    .map((line) => {
      const [id, localMd5, supabaseMd5] = line.split('|');
      return { id: Number(id), localMd5, supabaseMd5 };
    });

  const supabaseReferences = lines
    .filter((line) => /supabase\.(co|in|net)/i.test(line) && line.split('|').length >= 3)
    .map((line) => {
      const [tableName, id, offending] = line.split('|', 3);
      return { tableName, id: Number(id), offending };
    });

  return { rawOutput: result.stdout, rowDiffs, hashDiffs, supabaseReferences };
}

function buildRedactions(args, localDbUrl) {
  const indices = [];
  const dbIndex = args.indexOf(localDbUrl);
  if (dbIndex !== -1) {
    indices.push(dbIndex);
  }

  const passwordIndex = args.findIndex((value) => typeof value === 'string' && value.startsWith('SUPABASE_PASSWORD='));
  if (passwordIndex !== -1) {
    indices.push(passwordIndex);
    if (args[passwordIndex - 1] === '--set') {
      indices.push(passwordIndex - 1);
    }
  }

  return indices;
}

function buildReport({
  supabaseUrl,
  localDbUrl,
  schemaDumpPath,
  reportPath,
  skipExport,
  rawOutput,
  rowDiffs,
  hashDiffs,
  supabaseReferences
}) {
  const rowIssues = rowDiffs.filter((row) => row.rowDiff !== 0);
  const sections = [];

  sections.push('Supabase → Local validation report');
  sections.push('----------------------------------');
  sections.push(`Supabase: ${summariseConnection(supabaseUrl)}`);
  sections.push(`Local: ${summariseConnection(localDbUrl)}`);
  sections.push(`Schema dump: ${schemaDumpPath}`);
  sections.push(`Report path: ${reportPath}`);
  sections.push(`Exported this run: ${skipExport ? 'no (skip requested)' : 'yes'}`);
  sections.push('');

  sections.push('Row-count differences');
  if (rowIssues.length === 0) {
    sections.push('  None');
  } else {
    rowIssues.forEach((row) => {
      sections.push(
        `  ${row.tableName}: local=${row.localRows}, supabase=${row.supabaseRows}, diff=${row.rowDiff}`
      );
    });
  }

  sections.push('');
  sections.push('Hash mismatches (settings_versions)');
  if (hashDiffs.length === 0) {
    sections.push('  None');
  } else {
    hashDiffs.forEach((row) => {
      sections.push(`  id=${row.id}: local=${row.localMd5} supabase=${row.supabaseMd5}`);
    });
  }

  sections.push('');
  sections.push('Supabase URL references found locally');
  if (supabaseReferences.length === 0) {
    sections.push('  None');
  } else {
    supabaseReferences.forEach((row) => {
      sections.push(`  ${row.tableName} id=${row.id}: ${row.offending}`);
    });
  }

  sections.push('');
  sections.push('Raw psql output');
  sections.push('--------------');
  sections.push(rawOutput.trim() || '  <no output>');

  const mismatches = rowIssues.length + hashDiffs.length + supabaseReferences.length;
  const summary =
    mismatches === 0
      ? 'Comparison clean: no row-count, hash, or Supabase URL differences detected.'
      : `Comparison found ${mismatches} mismatched item(s). See ${reportPath} for details.`;

  return { summary, content: sections.join('\n') };
}

async function writeReport(reportPath, report) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report.content, 'utf8');
}

main().catch((error) => {
  console.error('\nDatabase agent failed.');
  console.error(error.message || error);
  process.exitCode = 1;
});

