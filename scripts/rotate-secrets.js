#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_ENV = path.join(ROOT_DIR, "backend", ".env");
const FRONTEND_ENV = path.join(ROOT_DIR, "frontend", ".env");
const ADMIN_CONFIG_PATH = path.join(ROOT_DIR, "backend", "data", "database-config.json");

const URLS = {
  supabaseApi: "https://supabase.com/dashboard/project/_/settings/api",
  supabaseDb: "https://supabase.com/dashboard/project/_/settings/database",
  googleCreds: "https://console.cloud.google.com/apis/credentials",
  smtpHelp: "https://support.google.com/accounts/answer/185833",
};

function parseArgs(argv) {
  return new Set(argv);
}

function isTruthy(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

function parseEnvLines(lines) {
  const env = {};
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    if (key) env[key] = value;
  }
  return env;
}

function upsertEnvLine(lines, key, value) {
  const next = [...lines];
  const entry = `${key}=${value}`;
  const index = next.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    next[index] = entry;
  } else {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(entry);
  }
  return next;
}

async function setEnvValue(filePath, key, value) {
  const lines = await loadEnvFile(filePath);
  const next = upsertEnvLine(lines, key, value);
  await fs.writeFile(filePath, next.join("\n"), "utf8");
}

function parseDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port || "(default)",
      database: url.pathname?.replace("/", "") || "",
      user: url.username || "",
      password: url.password ? "******" : "",
      raw,
    };
  } catch {
    return null;
  }
}

async function openUrl(url) {
  const { spawn } = require("child_process");
  const candidates = [
    { cmd: "open", args: [url] },
    { cmd: "xdg-open", args: [url] },
    { cmd: "cmd", args: ["/c", "start", "", url], windows: true },
  ];

  for (const { cmd, args } of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("open failed"))));
      });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function maybeOpen(label, url) {
  const opened = await openUrl(url);
  if (opened) {
    console.log(`✅ Opened ${label}: ${url}`);
  } else {
    console.log(`➡️  Open ${label}: ${url}`);
  }
}

async function loadAdminConfig() {
  try {
    const raw = await fs.readFile(ADMIN_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return null;
  }
}

async function showDatabaseLocation() {
  const backendLines = await loadEnvFile(BACKEND_ENV);
  const backendEnv = parseEnvLines(backendLines);
  const adminConfig = await loadAdminConfig();

  console.log("\n🔎 Database location check");
  if (adminConfig?.supabaseUrl) {
    console.log(`- backend/data/database-config.json → SUPABASE_URL=${adminConfig.supabaseUrl}`);
  }
  if (adminConfig?.friendlyName) {
    console.log(`- backend/data/database-config.json → DB_FRIENDLY_NAME=${adminConfig.friendlyName}`);
  }

  if (isTruthy(backendEnv.SUPABASE_URL)) {
    console.log(`- backend/.env → SUPABASE_URL=${backendEnv.SUPABASE_URL}`);
  }
  if (isTruthy(backendEnv.DATABASE_URL)) {
    const parsed = parseDatabaseUrl(backendEnv.DATABASE_URL);
    if (parsed) {
      console.log(
        `- backend/.env → DATABASE_URL host=${parsed.host} port=${parsed.port} db=${parsed.database} user=${parsed.user}`
      );
    } else {
      console.log(`- backend/.env → DATABASE_URL=${backendEnv.DATABASE_URL}`);
    }
  }

  if (isTruthy(backendEnv.DB_HOST)) {
    console.log(
      `- backend/.env → DB_HOST=${backendEnv.DB_HOST} DB_PORT=${backendEnv.DB_PORT || ""} DB_NAME=${
        backendEnv.DB_NAME || ""
      } DB_USER=${backendEnv.DB_USER || ""}`
    );
  }

  if (!isTruthy(backendEnv.SUPABASE_URL) && !isTruthy(backendEnv.DATABASE_URL) && !isTruthy(backendEnv.DB_HOST)) {
    console.log("⚠️  No database location configured in backend/.env.");
  }
}

async function promptInput(rl, question, { allowEmpty = true, mask = false } = {}) {
  if (!mask) {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(allowEmpty ? answer : answer.trim())));
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const onData = (char) => {
      char = String(char);
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004":
          stdin.pause();
          break;
        default:
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(`${question}${"*".repeat(rl.line.length)}`);
          break;
      }
    };
    stdin.on("data", onData);
    rl.question(question, (answer) => {
      stdin.removeListener("data", onData);
      resolve(allowEmpty ? answer : answer.trim());
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.has("--check-db")) {
    await showDatabaseLocation();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n🔐 Too Funny Productions — Secret Rotation Helper");
  console.log("This script will update local env files and open provider consoles when needed.\n");

  await maybeOpen("Supabase API Keys (anon/service_role)", URLS.supabaseApi);
  await maybeOpen("Supabase Database Passwords", URLS.supabaseDb);
  await maybeOpen("Google OAuth credentials", URLS.googleCreds);
  await maybeOpen("SMTP app password help", URLS.smtpHelp);

  try {
    const anonKey = await promptInput(
      rl,
      "\nNew Supabase anon key (VITE_SUPABASE_ANON_KEY) [leave blank to skip]: ",
      { mask: true }
    );
    if (isTruthy(anonKey)) {
      await setEnvValue(FRONTEND_ENV, "VITE_SUPABASE_ANON_KEY", anonKey.trim());
      console.log(`✅ Updated ${FRONTEND_ENV} (VITE_SUPABASE_ANON_KEY).`);
    }

    const serviceKey = await promptInput(
      rl,
      "\nNew Supabase service role key (SUPABASE_SERVICE_KEY) [leave blank to skip]: ",
      { mask: true }
    );
    if (isTruthy(serviceKey)) {
      await setEnvValue(BACKEND_ENV, "SUPABASE_SERVICE_KEY", serviceKey.trim());
      console.log(`✅ Updated ${BACKEND_ENV} (SUPABASE_SERVICE_KEY).`);
    }

    const dbPassword = await promptInput(
      rl,
      "\nNew database password (DB_PASSWORD) [leave blank to skip]: ",
      { mask: true }
    );
    if (isTruthy(dbPassword)) {
      const trimmed = dbPassword.trim();
      await setEnvValue(BACKEND_ENV, "DB_PASSWORD", trimmed);
      console.log(`✅ Updated ${BACKEND_ENV} (DB_PASSWORD).`);

      const backendLines = await loadEnvFile(BACKEND_ENV);
      const backendEnv = parseEnvLines(backendLines);
      if (isTruthy(backendEnv.DATABASE_URL)) {
        const updateUrl = await promptInput(
          rl,
          "Update password inside DATABASE_URL too? [y/N]: "
        );
        if (updateUrl.trim().toLowerCase() === "y") {
          const parsed = parseDatabaseUrl(backendEnv.DATABASE_URL);
          if (parsed) {
            const url = new URL(backendEnv.DATABASE_URL);
            url.password = trimmed;
            await setEnvValue(BACKEND_ENV, "DATABASE_URL", url.toString());
            console.log(`✅ Updated ${BACKEND_ENV} (DATABASE_URL password).`);
          } else {
            console.log("⚠️  DATABASE_URL could not be parsed; update it manually.");
          }
        }
      }
    }

    const googleSecret = await promptInput(
      rl,
      "\nNew Google client secret (GOOGLE_CLIENT_SECRET) [leave blank to skip]: ",
      { mask: true }
    );
    if (isTruthy(googleSecret)) {
      await setEnvValue(BACKEND_ENV, "GOOGLE_CLIENT_SECRET", googleSecret.trim());
      console.log(`✅ Updated ${BACKEND_ENV} (GOOGLE_CLIENT_SECRET).`);
    }

    const smtpPass = await promptInput(
      rl,
      "\nNew SMTP password (SMTP_PASS) [leave blank to skip]: ",
      { mask: true }
    );
    if (isTruthy(smtpPass)) {
      await setEnvValue(BACKEND_ENV, "SMTP_PASS", smtpPass.trim());
      console.log(`✅ Updated ${BACKEND_ENV} (SMTP_PASS).`);
    }

    const checkDb = await promptInput(rl, "\nCheck database location now? [y/N]: ");
    if (checkDb.trim().toLowerCase() === "y") {
      await showDatabaseLocation();
    }

    console.log("\nDone. Restart backend/frontend services to pick up new secrets.");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("❌ Secret rotation failed:", err?.message || err);
  process.exit(1);
});
