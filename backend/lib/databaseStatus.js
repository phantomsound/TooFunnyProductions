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
  if (override) return override;
  if (!hostname) return "Unconfigured database";
  if (hostname.includes("supabase.")) return "Supabase";
  if (LOCAL_HOSTS.has(hostname) || hostname.endsWith(".local")) return "MikoDB";
  return hostname;
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
  let connectivityError = null;

  if (configured) {
    const client = getSupabase();
    if (!client) {
      connectivity.ok = false;
      connectivity.message = "Supabase client unavailable";
    } else {
      const probe = await client.from("settings_public").select("id").limit(1);
      connectivity.ok = !probe.error;
      if (probe.error) {
        connectivityError = probe.error.message || "Failed to reach database";
        const hint = supabaseUrl
          ? `Confirm the PostgREST endpoint (${supabaseUrl.origin}${supabaseUrl.pathname}) is running and the service role key matches it.`
          : "Confirm the PostgREST endpoint is running and the service role key matches it.";
        connectivity.message = `${connectivityError}. ${hint}`;
      } else {
        connectivity.message = "Database reachable";
      }
    }
  }

  const warnings = [];
  if (!urlPresent) warnings.push("SUPABASE_URL is missing");
  if (!serviceKeyPresent) warnings.push("SUPABASE_SERVICE_KEY is missing");
  if (hostname?.includes("supabase.")) warnings.push("Supabase domain detected — point SUPABASE_URL at the MikoDB/PostgREST endpoint.");
  if (configured && !connectivity.ok) warnings.push("Configured but unreachable — double-check the PostgREST endpoint and service key");
  if (connectivityError) warnings.push(`Supabase/PostgREST error: ${connectivityError}`);

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
