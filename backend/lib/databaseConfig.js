// backend/lib/databaseConfig.js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const CONFIG_PATH = join(DATA_DIR, "database-config.json");

async function readConfigFile() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      console.warn("Failed to read database-config.json", err?.message || err);
    }
  }
  return {};
}

function sanitize(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function getEditableDatabaseConfig() {
  const stored = await readConfigFile();
  return {
    friendlyName: sanitize(stored.friendlyName),
    supabaseUrl: sanitize(stored.supabaseUrl),
    serviceKey: sanitize(stored.serviceKey),
    pgadminUrl: sanitize(stored.pgadminUrl),
  };
}

export async function getResolvedDatabaseConfig() {
  const stored = await getEditableDatabaseConfig();
  const envFriendly =
    sanitize(process.env.DB_FRIENDLY_NAME) || sanitize(process.env.DATABASE_FRIENDLY_NAME);

  return {
    friendlyName: stored.friendlyName || envFriendly || "",
    supabaseUrl: stored.supabaseUrl || sanitize(process.env.SUPABASE_URL),
    serviceKey: stored.serviceKey || sanitize(process.env.SUPABASE_SERVICE_KEY),
    pgadminUrl: stored.pgadminUrl || "",
  };
}

export async function saveDatabaseConfig({ friendlyName, supabaseUrl, serviceKey, pgadminUrl }) {
  const payload = {
    friendlyName: sanitize(friendlyName),
    supabaseUrl: sanitize(supabaseUrl),
    serviceKey: sanitize(serviceKey),
    pgadminUrl: sanitize(pgadminUrl),
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(payload, null, 2), "utf8");

  process.env.SUPABASE_URL = payload.supabaseUrl;
  process.env.SUPABASE_SERVICE_KEY = payload.serviceKey;
  process.env.DB_FRIENDLY_NAME = payload.friendlyName;
  process.env.PGADMIN_URL = payload.pgadminUrl;

  return payload;
}

