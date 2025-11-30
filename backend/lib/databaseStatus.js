// backend/lib/databaseStatus.js
import { createClient } from "@supabase/supabase-js";
import { URL } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return supabase;
}

function parseSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    return new URL(rawUrl);
  } catch (error) {
    return null;
  }
}

function deriveFriendlyName({ hostname, override }) {
  const preferred = override || "MikoDB";
  if (preferred) return preferred;
  if (hostname?.includes("supabase.co")) return "Supabase";
  return hostname || "Unconfigured database";
}

export async function getDatabaseStatus() {
  const supabaseUrl = parseSupabaseUrl(process.env.SUPABASE_URL);
  const override = (process.env.DB_FRIENDLY_NAME || process.env.DATABASE_FRIENDLY_NAME || "").trim() || null;
  const hostname = supabaseUrl?.hostname || null;
  const mode = hostname
    ? LOCAL_HOSTS.has(hostname) || hostname.endsWith(".local")
      ? "local"
      : "remote"
    : "unknown";
  const friendlyName = deriveFriendlyName({ hostname, override });
  const serviceKeyPresent = typeof process.env.SUPABASE_SERVICE_KEY === "string" && process.env.SUPABASE_SERVICE_KEY.length > 0;
  const urlPresent = !!supabaseUrl;
  const configured = urlPresent && serviceKeyPresent;

  const connectivity = {
    ok: false,
    message: configured ? "Checking connectivity…" : "Supabase/PostgREST not configured",
  };

  if (configured) {
    const client = getSupabase();
    if (!client) {
      connectivity.ok = false;
      connectivity.message = "Supabase client unavailable";
    } else {
      const probe = await client.from("settings_public").select("id").limit(1);
      connectivity.ok = !probe.error;
      connectivity.message = probe.error ? probe.error.message || "Failed to reach database" : "Database reachable";
    }
  }

  const warnings = [];
  if (!urlPresent) warnings.push("SUPABASE_URL is missing");
  if (!serviceKeyPresent) warnings.push("SUPABASE_SERVICE_KEY is missing");
  if (hostname?.includes("supabase.")) warnings.push("Supabase domain detected — point SUPABASE_URL at the MikoDB/PostgREST endpoint.");
  if (configured && !connectivity.ok) warnings.push("Configured but unreachable — double-check the PostgREST endpoint and service key");

  return {
    friendlyName,
    mode,
    host: hostname,
    url: supabaseUrl ? `${supabaseUrl.origin}${supabaseUrl.pathname}` : null,
    supabaseConfigured: configured,
    supabaseUrlPresent: urlPresent,
    serviceKeyPresent,
    connectivity,
    warnings,
  };
}
