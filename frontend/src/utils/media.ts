import { api } from "../lib/api";

const SUPABASE_PATH_REGEX = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i;
const LEGACY_PROXY_PATH_REGEX = /\/api\/storage\/objects\/public\/([^/]+)\/(.+)$/i;
const ALLOWED_BUCKETS = new Set(["media"]);

const envSupabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
let supabaseHost: string | null = null;
if (typeof envSupabaseUrl === "string" && envSupabaseUrl.trim()) {
  try {
    const parsed = new URL(envSupabaseUrl.trim());
    supabaseHost = parsed.host.toLowerCase();
  } catch {
    supabaseHost = null;
  }
}

const looksLikeSupabaseHost = (host: string) => {
  const normalized = host.toLowerCase();
  if (supabaseHost) return normalized === supabaseHost;
  return /\.supabase\.co$/i.test(normalized);
};

function parseSupabaseMediaUrl(input: string): { bucket: string; path: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const legacyMatch = parsed.pathname.match(LEGACY_PROXY_PATH_REGEX);
  if (legacyMatch) {
    const bucket = legacyMatch[1];
    const path = decodeURIComponent(legacyMatch[2]);
    if (!ALLOWED_BUCKETS.has(bucket)) return null;
    if (!path || path.includes("..")) return null;
    return { bucket, path };
  }

  if (!looksLikeSupabaseHost(parsed.host)) return null;
  const match = parsed.pathname.match(SUPABASE_PATH_REGEX);
  if (!match) return null;
  const bucket = match[1];
  const path = decodeURIComponent(match[2]);
  if (!ALLOWED_BUCKETS.has(bucket)) return null;
  if (!path || path.includes("..")) return null;
  return { bucket, path };
}

export function resolveMediaUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const supabase = parseSupabaseMediaUrl(trimmed);
  if (!supabase) return trimmed;

  const params = new URLSearchParams({
    bucket: supabase.bucket,
    path: supabase.path,
  });
  return api(`/api/storage/proxy?${params.toString()}`);
}

export function isSupabaseMediaUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return parseSupabaseMediaUrl(trimmed) !== null;
}
