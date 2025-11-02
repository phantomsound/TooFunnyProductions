// backend/lib/settingsLoader.js
// -----------------------------------------------------------------------------
// Shared helper to access the latest site settings for backend services.
// Mirrors the logic used by the /api/settings routes with graceful fallbacks.
// -----------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DEFAULT_SETTINGS_PATH = join(DATA_DIR, "settings.json");
const LOCAL_SETTINGS_PATH = join(DATA_DIR, "settings.local.json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

async function readJson(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn(`⚠️ Failed to read ${path}:`, err?.message || err);
    }
    return null;
  }
}

function stripMetaFields(data) {
  if (!data || typeof data !== "object") return {};
  const clone = { ...data };
  delete clone.id;
  delete clone.created_at;
  delete clone.updated_at;
  delete clone.published_at;
  delete clone.stage;
  return clone;
}

export async function loadSettings(stage = "draft") {
  if (supabase) {
    const table = stage === "live" ? "settings_public" : "settings_draft";
    const sel = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (sel.error && sel.error.code !== "PGRST116") {
      console.error("Failed to query settings from Supabase:", sel.error.message || sel.error);
    } else if (sel.data) {
      return stripMetaFields(sel.data);
    }
  }

  const override = await readJson(LOCAL_SETTINGS_PATH);
  if (override) return override;
  const fallback = await readJson(DEFAULT_SETTINGS_PATH);
  return fallback || {};
}

