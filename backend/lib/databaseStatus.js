// backend/lib/databaseStatus.js
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  decodeSupabaseRole,
  hasServiceRoleKey,
  isLocalSupabaseUrl,
  parseSupabaseUrl,
} from "./supabaseKey.js";
import { getResolvedDatabaseConfig } from "./databaseConfig.js";

let postgrest = { client: null, cacheKey: "" };
function getPostgrest(config) {
  const cacheKey = `${config.supabaseUrl || ""}::${config.serviceKey || ""}`;
  if (postgrest.client && postgrest.cacheKey === cacheKey) return postgrest.client;

  if (!config.supabaseUrl || !config.serviceKey) {
    postgrest = { client: null, cacheKey: "" };
    return null;
  }

  const baseUrl = config.supabaseUrl.replace(/\/+$/, "");

  postgrest = {
    cacheKey,
    client: new PostgrestClient(baseUrl, {
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    }),
  };
  return postgrest.client;
}

export function resetDatabaseStatusCache() {
  postgrest = { client: null, cacheKey: "" };
}

function deriveFriendlyName({ hostname, override, isLocal }) {
  if (override) return override;
  if (!hostname) return "Unconfigured database";
  if (hostname.includes("supabase.")) return "Supabase";
  if (isLocal || hostname.endsWith(".local")) return "MikoDB";
  return hostname;
}

export async function getDatabaseStatus() {
  const config = await getResolvedDatabaseConfig();

  const supabaseUrl = parseSupabaseUrl(config.supabaseUrl);
  const supabaseIsLocal = isLocalSupabaseUrl(config.supabaseUrl);
  const override = (config.friendlyName || "").trim() || null;
  const hostname = supabaseUrl?.hostname || null;
  const mode = hostname ? (supabaseIsLocal ? "local" : "remote") : "unknown";
  const friendlyName = deriveFriendlyName({ hostname, override, isLocal: supabaseIsLocal });
  const serviceKeyPresent = typeof config.serviceKey === "string" && config.serviceKey.length > 0;
  const urlPresent = !!supabaseUrl;
  const configured = urlPresent && serviceKeyPresent;

  const connectivity = {
    ok: false,
    message: configured ? "Checking connectivity…" : "Supabase/PostgREST not configured",
  };
  let connectivityError = null;
  const keyRole = decodeSupabaseRole(config.serviceKey);
  const hasServiceRole = supabaseIsLocal ? serviceKeyPresent : hasServiceRoleKey(config.serviceKey);

  if (configured) {
    const client = getPostgrest({ supabaseUrl: config.supabaseUrl, serviceKey: config.serviceKey });
    if (!client) {
      connectivity.ok = false;
      connectivity.message = "Supabase client unavailable";
    } else {
      const probe = await client.from("settings_public").select("id").limit(1);
      connectivity.ok = !probe.error;
      if (probe.error) {
        connectivityError = probe.error.message || "Failed to reach database";
        const hint = supabaseUrl
          ? `Confirm the PostgREST endpoint (${supabaseUrl.origin}${supabaseUrl.pathname}) is running and the JWT in SUPABASE_SERVICE_KEY matches its secret.`
          : "Confirm the PostgREST endpoint is running and the JWT in SUPABASE_SERVICE_KEY matches its secret.";
        connectivity.message = `${connectivityError}. ${hint}`;
      } else {
        connectivity.message = "Database reachable";
      }
    }
  }

  const warnings = [];
  if (!urlPresent)
    warnings.push("SUPABASE_URL is missing — set it to your local PostgREST endpoint (e.g., http://127.0.0.1:54321).");
  if (!serviceKeyPresent)
    warnings.push("SUPABASE_SERVICE_KEY is missing — paste the local JWT for your PostgREST stack.");
  if (serviceKeyPresent && !hasServiceRole && !supabaseIsLocal)
    warnings.push(
      "The configured SUPABASE_SERVICE_KEY is not a service_role key; pulls and publishes will fail against Supabase until it is updated."
    );
  if (hostname?.includes("supabase.")) warnings.push("Supabase domain detected — point SUPABASE_URL at the MikoDB/PostgREST endpoint.");
  if (configured && !connectivity.ok) warnings.push("Configured but unreachable — double-check the PostgREST endpoint and service key");
  if (connectivityError) warnings.push(`Supabase/PostgREST error: ${connectivityError}`);

  return {
    friendlyName,
    mode,
    host: hostname,
    url: supabaseUrl
      ? `${supabaseUrl.origin}${supabaseUrl.pathname === "/" ? "" : supabaseUrl.pathname.replace(/\/$/, "")}`
      : null,
    supabaseConfigured: configured,
    supabaseUrlPresent: urlPresent,
    serviceKeyPresent,
    serviceKeyRole: keyRole,
    hasServiceRole,
    connectivity,
    warnings,
  };
}
