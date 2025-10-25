import { api } from "../lib/api";

const SUPABASE_STORAGE_PATTERNS = [
  /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i,
  /\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/i,
  /\/storage\/v1\/render\/image\/public\/([^/]+)\/(.+)$/i,
  /\/storage\/v1\/render\/image\/sign\/([^/]+)\/(.+)$/i,
];
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
  return /\.supabase\.(co|in|net)$/i.test(normalized);
};

function parseSupabaseMediaUrl(input: string): { bucket: string; path: string } | null {
  if (!input) return null;

  let parsed: URL;
  let isRelative = false;
  try {
    parsed = new URL(input);
  } catch {
    try {
      parsed = new URL(input, "http://placeholder.local");
      isRelative = true;
    } catch {
      return null;
    }
  }

  const legacyMatch = parsed.pathname.match(LEGACY_PROXY_PATH_REGEX);
  if (legacyMatch) {
    const bucket = legacyMatch[1];
    const path = decodeURIComponent(legacyMatch[2]);
    if (!ALLOWED_BUCKETS.has(bucket)) return null;
    if (!path || path.includes("..")) return null;
    return { bucket, path };
  }

  if (!isRelative && !looksLikeSupabaseHost(parsed.host)) return null;

  for (const pattern of SUPABASE_STORAGE_PATTERNS) {
    const match = parsed.pathname.match(pattern);
    if (!match) continue;
    const bucket = match[1];
    const path = decodeURIComponent(match[2]);
    if (!ALLOWED_BUCKETS.has(bucket)) return null;
    if (!path || path.includes("..")) return null;
    return { bucket, path };
  }

  return null;
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
