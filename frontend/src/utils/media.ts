import { api } from "../lib/api";

const SUPABASE_STORAGE_PATTERNS = [
  /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i,
  /\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/i,
  /\/storage\/v1\/render\/image\/public\/([^/]+)\/(.+)$/i,
  /\/storage\/v1\/render\/image\/sign\/([^/]+)\/(.+)$/i,
];
const LEGACY_PROXY_PATH_REGEX = /\/api\/storage\/objects\/public\/([^/]+)\/(.+)$/i;
const PROXY_PATH_REGEX = /\/api\/storage\/proxy(?:\\?|$)/i;
const ALLOWED_BUCKETS = new Set(["media"]);

const envSupabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
let supabaseHost: string | null = null;
let supabaseIsLocal = false;
if (typeof envSupabaseUrl === "string" && envSupabaseUrl.trim()) {
  try {
    const parsed = new URL(envSupabaseUrl.trim());
    supabaseHost = parsed.host.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    supabaseIsLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1";
  } catch {
    supabaseHost = null;
    supabaseIsLocal = false;
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

  for (const pattern of SUPABASE_STORAGE_PATTERNS) {
    const match = parsed.pathname.match(pattern);
    if (!match) continue;
    const bucket = match[1];
    const path = decodeURIComponent(match[2]);
    if (!ALLOWED_BUCKETS.has(bucket)) return null;
    if (!path || path.includes("..")) return null;
    return { bucket, path };
  }

  if (!isRelative && !looksLikeSupabaseHost(parsed.host)) return null;

  return null;
}

function parseProxyMediaUrl(input: string): { bucket: string; path: string } | null {
  if (!input) return null;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    try {
      parsed = new URL(input, "http://placeholder.local");
    } catch {
      return null;
    }
  }

  if (!PROXY_PATH_REGEX.test(parsed.pathname)) return null;
  const bucket = parsed.searchParams.get("bucket") || "";
  const path = parsed.searchParams.get("path") || "";
  if (!ALLOWED_BUCKETS.has(bucket)) return null;
  if (!path || path.includes("..")) return null;
  return { bucket, path };
}

function buildPublicUrl(bucket: string, path: string) {
  if (!envSupabaseUrl || supabaseIsLocal) return null;
  try {
    const base = new URL(envSupabaseUrl.trim());
    const trimmedPath = path.replace(/^\/+/, "");
    return `${base.origin}/storage/v1/object/public/${bucket}/${encodeURIComponent(trimmedPath).replace(/%2F/g, "/")}`;
  } catch {
    return null;
  }
}

export function resolveMediaUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const proxy = parseProxyMediaUrl(trimmed);
  if (proxy) {
    const publicUrl = buildPublicUrl(proxy.bucket, proxy.path);
    if (publicUrl) return publicUrl;
    return trimmed;
  }

  const supabase = parseSupabaseMediaUrl(trimmed);
  if (!supabase) return trimmed;

  const publicUrl = buildPublicUrl(supabase.bucket, supabase.path);
  if (publicUrl) return publicUrl;

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
