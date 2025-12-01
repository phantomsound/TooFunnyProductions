// backend/lib/supabaseKey.js
// -----------------------------------------------------------------------------
// Helpers for inspecting Supabase keys without making network calls.
// -----------------------------------------------------------------------------

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;

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

