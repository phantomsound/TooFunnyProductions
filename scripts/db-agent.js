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
  const includeData = !!args.includeData;
  const dropAndRestore = !!args.dropAndRestore;
  const validationBaseUrl = args.validationBaseUrl || process.env.VALIDATION_BASE_URL;
  const retryNotes = [];

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultReport = path.join(defaultDocsPath, 'reports', `fdw-compare-${timestamp}.log`);
  const reportPath = path.resolve(args.reportPath || defaultReport);

  const restoreBackendEnv = await protectBackendEnv();

  try {
    await ensureDirectories();

    const schemaDumpPath = path.join(defaultDocsPath, 'schema', 'supabase_schema.sql');
    const fullDumpPath = path.join(defaultDocsPath, 'schema', 'supabase_full.sql');

    if (skipExport) {
      console.log(`Skipping Supabase export and reusing ${schemaDumpPath}`);
    } else {
      const { errors: schemaExportRetries } = await runWithRetries('Supabase schema export', (attempt) =>
        exportSchema({ supabaseUrl, schemaDumpPath, attempt })
      );
      recordRetryNotes(schemaExportRetries, 'Supabase schema export', retryNotes);
    }

    if (includeData) {
      if (skipExport) {
        console.log(`Skipping Supabase full dump export and reusing ${fullDumpPath}`);
      } else {
        const { errors: fullExportRetries } = await runWithRetries('Supabase full export', (attempt) =>
          exportFullDump({ supabaseUrl, fullDumpPath, attempt })
        );
        recordRetryNotes(fullExportRetries, 'Supabase full export', retryNotes);
      }
    }

    const { localDbName, localAdminUrl } = buildLocalDatabaseUrls(localDbUrl, adminDb);

    if (interactive) {
      await ensureDatabasePrepared({ rl, localAdminUrl, localDbName });
    } else if (!dropAndRestore) {
      await recreateDatabase(localAdminUrl, localDbName);
    }

    const dumpToApply = includeData ? fullDumpPath : schemaDumpPath;
    const { errors: applyRetries } = await runWithRetries('Local restore', async (attempt) => {
      if (dropAndRestore) {
        await recreateDatabase(localAdminUrl, localDbName);
      }
      return applySchema({ localDbUrl, schemaDumpPath: dumpToApply, attempt });
    });
    recordRetryNotes(applyRetries, 'Local restore', retryNotes);

    const validationResults = await runValidations({ localDbUrl, validationBaseUrl });

    const { result: compareResult, errors: compareRetries } = await runWithRetries(
      'FDW comparison',
      (attempt) => runFdwComparison({ supabaseUrl, localDbUrl, attempt })
    );
    recordRetryNotes(compareRetries, 'FDW comparison', retryNotes);
    const report = buildReport({
      supabaseUrl,
      localDbUrl,
      schemaDumpPath,
      fullDumpPath,
      reportPath,
      skipExport,
      includeData,
      validationResults,
      retryNotes,
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
      case '--include-data':
        flags.includeData = true;
        break;
      case '--validation-base-url':
        flags.validationBaseUrl = value || null;
        break;
      case '--drop-and-restore':
        flags.dropAndRestore = true;
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
  fullDumpPath,
  reportPath,
  skipExport,
  includeData,
  validationResults = [],
  retryNotes = [],
  rawOutput,
  rowDiffs,
  hashDiffs,
  supabaseReferences
}) {
  const rowIssues = rowDiffs.filter((row) => row.rowDiff !== 0);
  const validationIssues = validationResults.filter((check) => check.status !== 'pass');
  const sections = [];

  sections.push('Supabase → Local validation report');
  sections.push('----------------------------------');
  sections.push(`Supabase: ${summariseConnection(supabaseUrl)}`);
  sections.push(`Local: ${summariseConnection(localDbUrl)}`);
  sections.push(`Schema dump: ${schemaDumpPath}`);
  if (includeData) {
    sections.push(`Full dump: ${fullDumpPath}`);
  }
  sections.push(`Report path: ${reportPath}`);
  sections.push(`Exported this run: ${skipExport ? 'no (skip requested)' : 'yes'}`);
  sections.push(`Data imported: ${includeData ? 'yes (schema + data)' : 'no (schema only)'}`);
  sections.push('');

  sections.push('Post-restore validation');
  if (validationResults.length === 0) {
    sections.push('  No validation checks were executed.');
  } else {
    validationResults.forEach((check) => {
      const indicator = check.status === 'pass' ? '✓' : '✗';
      sections.push(`  [${indicator}] ${check.name}: ${check.message}`);
    });
  }
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

  if (retryNotes.length > 0) {
    sections.push('');
    sections.push('Retry diagnostics');
    sections.push('-----------------');
    retryNotes.forEach((note) => sections.push(`- ${note}`));
  }

  const mismatches = rowIssues.length + hashDiffs.length + supabaseReferences.length;
  const parts = [];
  if (validationResults.length === 0) {
    parts.push('No validation checks executed.');
  } else if (validationIssues.length === 0) {
    parts.push('Post-restore validation passed.');
  } else {
    parts.push(`Validation failed for ${validationIssues.length} check(s).`);
  }

  if (mismatches === 0) {
    parts.push('Comparison clean: no row-count, hash, or Supabase URL differences detected.');
  } else {
    parts.push(`Comparison found ${mismatches} mismatched item(s).`);
  }

  const summary = `${parts.join(' ')} See ${reportPath} for details.`;

  return { summary, content: sections.join('\n') };
}

async function writeReport(reportPath, report) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report.content, 'utf8');
}

async function runValidations({ localDbUrl, validationBaseUrl }) {
  const checks = [];

  const sqlChecks = [
    {
      name: 'settings_versions has rows',
      query: 'SELECT COUNT(*) FROM settings_versions;'
    },
    {
      name: 'settings_public available',
      query: 'SELECT COUNT(*) FROM settings_public;'
    },
    {
      name: 'admin_actions table exists',
      query: "SELECT to_regclass('public.admin_actions') IS NOT NULL AS present;",
      interpret: (value) => value === 't'
    }
  ];

  for (const check of sqlChecks) {
    try {
      const args = [
        '--tuples-only',
        '--no-align',
        '--quiet',
        '--dbname',
        localDbUrl,
        '--command',
        check.query
      ];
      const result = await runCommand('psql', args, {
        redactArgs: [args.indexOf(localDbUrl)],
        captureStdout: true
      });
      const value = result.stdout.trim();
      const interpreted = check.interpret ? check.interpret(value) : Number(value) > 0;
      if (interpreted) {
        checks.push({ name: check.name, status: 'pass', message: `Result ${value}` });
      } else {
        checks.push({
          name: check.name,
          status: 'fail',
          message: `Unexpected result (${value}). Verify data import.`
        });
      }
    } catch (error) {
      checks.push({ name: check.name, status: 'fail', message: error.message || String(error) });
    }
  }

  if (validationBaseUrl) {
    const baseUrl = validationBaseUrl.replace(/\/$/, '');
    const endpoint = `${baseUrl}/api/health`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        checks.push({ name: 'HTTP health check', status: 'pass', message: `${endpoint} responded ${response.status}` });
      } else {
        checks.push({
          name: 'HTTP health check',
          status: 'fail',
          message: `${endpoint} responded ${response.status}. Ensure backend is running.`
        });
      }
    } catch (error) {
      checks.push({
        name: 'HTTP health check',
        status: 'fail',
        message: `${endpoint} failed: ${error.message || error}`
      });
    }
  }

  return checks;
}

function buildDiagnosticHint(error) {
  const message = (error?.message || String(error || '')).toLowerCase();
  if (message.includes('authentication failed')) {
    return 'Authentication failed. Confirm username/password and URL-encode special characters (e.g., %40 for @).';
  }
  if (message.includes('certificate') || message.includes('ssl') || message.includes('tls')) {
    return 'SSL negotiation issue. Ensure sslmode=require is set and certificates are trusted.';
  }
  if (message.includes('getaddrinfo') || message.includes('enotfound') || message.includes('name or service not known')) {
    return 'DNS/host resolution failed. Verify the hostname and network connectivity.';
  }
  return null;
}

async function runWithRetries(label, fn, { attempts = 3 } = {}) {
  const errors = [];
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn(attempt);
      return { result, errors };
    } catch (error) {
      lastError = error;
      const hint = buildDiagnosticHint(error);
      errors.push({
        attempt,
        message: error.message || String(error),
        hint
      });
      if (attempt < attempts) {
        console.warn(`${label} failed (attempt ${attempt}/${attempts}). Retrying...`);
        if (hint) {
          console.warn(`Hint: ${hint}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  const hintSuffix = errors[errors.length - 1]?.hint ? ` Hint: ${errors[errors.length - 1].hint}` : '';
  const failure = new Error(`${label} failed after ${attempts} attempt(s): ${lastError?.message || lastError}.${hintSuffix}`);
  failure.retryErrors = errors;
  throw failure;
}

function recordRetryNotes(errors, label, collector) {
  if (!collector || !errors || errors.length === 0) return;
  const hints = errors
    .map((entry) => entry.hint)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  const noteParts = [`${label} required ${errors.length + 1} attempt(s)`];
  if (hints.length > 0) {
    noteParts.push(`Troubleshooting hints: ${hints.join(' ')}`);
  }
  collector.push(noteParts.join('. '));
}

async function exportFullDump({ supabaseUrl, fullDumpPath }) {
  console.log(`\nExporting Supabase schema and data to ${fullDumpPath}`);
  const args = ['--no-owner', '--no-privileges', '--file', fullDumpPath, '--dbname', supabaseUrl];
  await runCommand('pg_dump', args, { redactArgs: [args.indexOf(supabaseUrl)] });
}

main().catch((error) => {
  console.error('\nDatabase agent failed.');
  console.error(error.message || error);
  process.exitCode = 1;
});

