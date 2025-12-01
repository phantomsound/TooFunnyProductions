// backend/lib/supabaseKey.js
// -----------------------------------------------------------------------------
// Helpers for inspecting Supabase keys without making network calls.
// -----------------------------------------------------------------------------

import { URL } from "node:url";

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const LOCAL_SUPABASE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function decodeSupabaseRole(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;

  const parts = rawKey.split(".");
  if (parts.length < 2) return null;

  const payload = parts[1];
  if (!BASE64_URL_PATTERN.test(payload)) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const data = JSON.parse(json);
    const role = typeof data?.role === "string" ? data.role.toLowerCase() : null;
    return role || null;
  } catch (err) {
    console.warn("Failed to decode Supabase key role:", err?.message || err);
    return null;
  }
}

export function hasServiceRoleKey(rawKey) {
  return decodeSupabaseRole(rawKey) === "service_role";
}

export function parseSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    return new URL(rawUrl);
  } catch (error) {
    return null;
  }
}

export function isLocalSupabaseUrl(rawUrl) {
  const url = parseSupabaseUrl(rawUrl);
  if (!url) return false;
  return LOCAL_SUPABASE_HOSTS.has(url.hostname) || url.hostname.endsWith(".local");
}

