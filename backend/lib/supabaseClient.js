// backend/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";
import { getResolvedDatabaseConfig } from "./databaseConfig.js";
import { hasServiceRoleKey, isLocalSupabaseUrl } from "./supabaseKey.js";

let cachedClient = null;
let cachedKey = "";

export async function getSupabaseServiceContext() {
  const config = await getResolvedDatabaseConfig();
  const supabaseUrl = config.supabaseUrl;
  const serviceKey = config.serviceKey;
  const cacheKey = `${supabaseUrl || ""}::${serviceKey || ""}`;

  if (!supabaseUrl || !serviceKey) {
    cachedClient = null;
    cachedKey = cacheKey;
    return {
      client: null,
      supabaseUrl,
      serviceKey,
      supabaseIsLocal: isLocalSupabaseUrl(supabaseUrl),
      hasServiceRole: false,
    };
  }

  if (!cachedClient || cachedKey !== cacheKey) {
    cachedClient = createClient(supabaseUrl, serviceKey);
    cachedKey = cacheKey;
  }

  const supabaseIsLocal = isLocalSupabaseUrl(supabaseUrl);
  const hasServiceRole = serviceKey ? (supabaseIsLocal ? true : hasServiceRoleKey(serviceKey)) : false;

  return {
    client: cachedClient,
    supabaseUrl,
    serviceKey,
    supabaseIsLocal,
    hasServiceRole,
  };
}

export async function getSupabaseServiceClient() {
  const context = await getSupabaseServiceContext();
  return context.client;
}

export function resetSupabaseServiceClient() {
  cachedClient = null;
  cachedKey = "";
}
