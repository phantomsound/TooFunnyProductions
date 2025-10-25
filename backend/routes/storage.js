/* =========================================================================
   FILE: backend/routes/storage.js
   -------------------------------------------------------------------------
   Single-bucket media API with list/upload/rename/delete and
   URL reference updates inside settings_draft/settings_public.
   ========================================================================= */
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { requireAdmin } from "../auth.js";
import { logAdminAction } from "../lib/audit.js";

const router = Router();
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

const hasNativeFetch = typeof fetch === "function";

function requestWithNode(url, method) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === "https:" ? httpsRequest : httpRequest;
      const req = client(
        {
          method,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          headers: { Accept: "*/*" },
        },
        (res) => {
          const chunks = [];
          if (method !== "HEAD") {
            res.on("data", (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
          }
          res.on("end", () => {
            const normalizedHeaders = Object.fromEntries(
              Object.entries(res.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
            );
            resolve({
              ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
              status: res.statusCode || 500,
              headers: normalizedHeaders,
              buffer: method === "HEAD" ? null : Buffer.concat(chunks),
            });
          });
        }
      );
      req.on("error", reject);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function fetchUpstream(url, method) {
  if (hasNativeFetch) {
    const response = await fetch(url, { method });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const buffer = method === "HEAD" ? null : Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      headers,
      buffer,
    };
  }

  return requestWithNode(url, method);
}

const upload = multer({ storage: multer.memoryStorage() });

const BUCKET = "media";

// Build public URL from path
function ensureSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: "Supabase not configured." });
    return false;
  }
  return true;
}

function sanitizeProxyPath(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const plusNormalized = trimmed.replace(/\+/g, " ");
  let decoded;
  try {
    decoded = decodeURIComponent(plusNormalized);
  } catch (error) {
    return null;
  }

  const withoutLeadingSlash = decoded.replace(/^\/+/g, "");
  if (!withoutLeadingSlash || withoutLeadingSlash.includes("..")) {
    return null;
  }

  return withoutLeadingSlash;
}

router.get("/proxy", async (req, res) => {
  if (!ensureSupabase(res)) return;

  const bucket = typeof req.query.bucket === "string" ? req.query.bucket.trim() : "";
  const rawPath = typeof req.query.path === "string" ? req.query.path.trim() : "";

  if (!bucket || !rawPath) {
    return res.status(400).json({ error: "bucket and path query parameters are required" });
  }

  if (bucket !== BUCKET) {
    return res.status(403).json({ error: "Access to requested bucket is not allowed" });
  }

  const path = sanitizeProxyPath(rawPath);
  if (!path) {
    return res.status(400).json({ error: "Invalid path" });
  }

  try {
    const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
    if (signed.error) throw signed.error;
    const signedUrl = signed.data?.signedUrl;
    if (!signedUrl) throw new Error("Failed to generate signed media URL");

    const method = req.method === "HEAD" ? "HEAD" : "GET";
    const upstream = await fetchUpstream(signedUrl, method);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream fetch failed (${upstream.status})` });
    }

    const rawContentType = upstream.headers["content-type"] || "application/octet-stream";
    const rawCacheControl = upstream.headers["cache-control"] || "public, max-age=1800, s-maxage=1800";
    const rawContentLength = upstream.headers["content-length"];

    const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
    const cacheControl = Array.isArray(rawCacheControl) ? rawCacheControl[0] : rawCacheControl;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    if (rawContentLength) {
      const lengthValue = Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength;
      if (lengthValue) {
        res.setHeader("Content-Length", lengthValue);
      }
    }

    if (method === "HEAD") {
      return res.status(upstream.status || 200).end();
    }

    res.status(upstream.status || 200).send(upstream.buffer ?? Buffer.alloc(0));
  } catch (err) {
    console.error("GET /api/storage/proxy error:", err);
    res.status(500).json({ error: "Failed to proxy media" });
  }
});

function publicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const PROXY_PATHNAME = "/api/storage/proxy";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function updateProxyReference(original, fromPath, toPath) {
  if (typeof original !== "string") return null;
  const trimmed = original.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().includes("/api/storage/proxy")) return null;

  try {
    let style = "absolute";
    let parsed;
    if (/^https?:\/\//i.test(trimmed)) {
      parsed = new URL(trimmed);
    } else if (trimmed.startsWith("//")) {
      parsed = new URL(`http:${trimmed}`);
      style = "protocol-relative";
    } else if (trimmed.startsWith("/")) {
      parsed = new URL(`http://placeholder.local${trimmed}`);
      style = "absolute-path";
    } else {
      parsed = new URL(trimmed, "http://placeholder.local");
      style = "relative";
    }

    if (parsed.pathname !== PROXY_PATHNAME) return null;
    const currentBucket = parsed.searchParams.get("bucket");
    const currentPath = parsed.searchParams.get("path");
    if (currentBucket && currentBucket !== BUCKET) return null;
    if (currentPath !== fromPath) return null;

    const nextParams = new URLSearchParams(parsed.searchParams);
    nextParams.set("bucket", BUCKET);
    nextParams.set("path", toPath);
    const suffix = `${PROXY_PATHNAME}?${nextParams.toString()}`;

    switch (style) {
      case "protocol-relative":
        return `//${parsed.host}${suffix}`;
      case "absolute-path":
        return suffix;
      case "relative": {
        const lower = trimmed.toLowerCase();
        const marker = lower.indexOf("api/storage/proxy");
        const prefix = marker > 0 ? trimmed.slice(0, marker) : "";
        const withoutLeadingSlash = suffix.startsWith("/") ? suffix.slice(1) : suffix;
        return `${prefix}${withoutLeadingSlash}`;
      }
      case "absolute":
      default:
        return `${parsed.protocol}//${parsed.host}${suffix}`;
    }
  } catch {
    return null;
  }
}

function replaceUrls(value, context) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { value, changed: false };
    }

    if (context.oldPublicUrl && trimmed === context.oldPublicUrl) {
      return { value: context.newPublicUrl, changed: true };
    }

    if (context.fromPath && trimmed === context.fromPath) {
      return { value: context.toPath, changed: true };
    }

    const proxy =
      context.fromPath && context.toPath ? updateProxyReference(value, context.fromPath, context.toPath) : null;
    if (proxy) {
      return { value: proxy, changed: true };
    }

    return { value, changed: false };
  }

  if (Array.isArray(value)) {
    let mutated = false;
    const next = value.map((entry) => {
      const replaced = replaceUrls(entry, context);
      if (replaced.changed) mutated = true;
      return replaced.changed ? replaced.value : entry;
    });
    return mutated ? { value: next, changed: true } : { value, changed: false };
  }

  if (value && typeof value === "object") {
    let mutated = false;
    const next = { ...value };
    for (const [key, entry] of Object.entries(value)) {
      const replaced = replaceUrls(entry, context);
      if (replaced.changed) {
        next[key] = replaced.value;
        mutated = true;
      }
    }
    return mutated ? { value: next, changed: true } : { value, changed: false };
  }

  return { value, changed: false };
}

// Replace stored references (including nested JSON + proxy URLs) in a settings table row
async function replaceUrlInTable(table, { fromPath, toPath, oldPublicUrl, newPublicUrl }) {
  if (!supabase) return;
  const sel = await supabase.from(table).select("*").limit(1).maybeSingle();
  if (sel.error) throw sel.error;
  const row = sel.data;
  if (!row) return;

  const context = {
    fromPath: typeof fromPath === "string" ? fromPath.trim() : "",
    toPath: typeof toPath === "string" ? toPath.trim() : "",
    oldPublicUrl: normalizeString(oldPublicUrl),
    newPublicUrl: normalizeString(newPublicUrl),
  };

  const replaced = replaceUrls(row, context);
  if (!replaced.changed) return;

  const upd = await supabase
    .from(table)
    .update({ ...replaced.value, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (upd.error) throw upd.error;
}

// --- LIST --------------------------------------------------------------
router.get("/list", requireAdmin, async (req, res) => {
  if (!ensureSupabase(res)) return;
  try {
    const { prefix = "", limit = 1000, sort = "updated_at", direction = "desc", q } = req.query;
    const listOpts = {
      limit: Number(limit) || 1000,
      offset: 0,
      search: q ? String(q) : undefined,
    };

    const { data, error } = await supabase.storage.from(BUCKET).list(prefix || "", listOpts);
    if (error) throw error;

    const entries = (data || [])
      .map((f) => ({
        name: f.name,
        path: (prefix ? `${prefix}/` : "") + f.name,
        size: f.metadata?.size ?? null,
        created_at: f.created_at ?? null,
        updated_at: f.updated_at ?? null,
        mime_type: f.metadata?.mimetype ?? null,
        url: publicUrl((prefix ? `${prefix}/` : "") + f.name),
        isDir: !f.metadata && !f.created_at && !f.updated_at,
      }))
      .filter((item) => item.name !== "uploads" && item.name !== "incoming")
      .filter((item) => !item.isDir);

    const sortKey = typeof sort === "string" ? sort : "updated_at";
    const dir = String(direction).toLowerCase() === "asc" ? 1 : -1;

    const sorted = entries.sort((a, b) => {
      const fallbackA = new Date(a.updated_at || a.created_at || 0).getTime();
      const fallbackB = new Date(b.updated_at || b.created_at || 0).getTime();

      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "size":
          return dir * ((a.size || 0) - (b.size || 0));
        case "created_at":
          return dir *
            (new Date(a.created_at || a.updated_at || 0).getTime() -
              new Date(b.created_at || b.updated_at || 0).getTime());
        case "updated_at":
        default:
          return dir * (fallbackA - fallbackB);
      }
    });

    res.json({ items: sorted });
  } catch (err) {
    console.error("GET /api/storage/list error:", err);
    res.status(500).json({ error: "Failed to list" });
  }
});

// --- INSPECT ----------------------------------------------------------
router.get("/inspect", requireAdmin, async (req, res) => {
  if (!ensureSupabase(res)) return;
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  const path = rawPath.trim();
  if (!path) {
    return res.status(400).json({ error: "path query parameter is required" });
  }

  try {
    const { data, error } = await supabase
      .from("storage.objects")
      .select("id,name,bucket_id,created_at,updated_at,last_accessed_at,metadata")
      .eq("bucket_id", BUCKET)
      .eq("name", path)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;

    const object = data ?? null;
    const url = publicUrl(path);

    let publicUrlStatus = null;
    try {
      const head = await fetchUpstream(url, "HEAD");
      publicUrlStatus = head.status;
    } catch {}

    let signedUrl = null;
    if (object) {
      const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
      if (!signed.error) {
        signedUrl = signed.data?.signedUrl ?? null;
      }
    }

    res.json({
      path,
      exists: Boolean(object),
      object,
      publicUrl: url,
      publicUrlStatus,
      signedUrl,
    });
  } catch (err) {
    console.error("GET /api/storage/inspect error:", err);
    res.status(500).json({ error: "Failed to inspect path" });
  }
});

// --- UPLOAD ------------------------------------------------------------
router.post("/upload", requireAdmin, upload.single("file"), async (req, res) => {
  if (!ensureSupabase(res)) return;
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });

    const filePath = `${Date.now()}_${file.originalname}`;
    const { data, error } = await supabase.storage.from(BUCKET).upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) throw error;

    const url = publicUrl(data.path);
    try {
      await logAdminAction(req.user?.email || "unknown", "media.upload", {
        path: data.path,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        url,
      });
    } catch {}
    res.json({ path: data.path, url });
  } catch (err) {
    console.error("POST /api/storage/upload error:", err);
    res.status(500).json({ error: "Failed to upload" });
  }
});

// --- DELETE ------------------------------------------------------------
router.post("/delete", requireAdmin, async (req, res) => {
  if (!ensureSupabase(res)) return;
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: "path required" });

    const oldUrl = publicUrl(path);
    const del = await supabase.storage.from(BUCKET).remove([path]);
    if (del.error) throw del.error;

    try {
      await logAdminAction(req.user?.email || "unknown", "media.delete", { path, oldUrl });
    } catch {}
    // We don't auto-clear references on delete (safer); UI should warn.
    res.json({ success: true, deleted: path, oldUrl });
  } catch (err) {
    console.error("POST /api/storage/delete error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// --- RENAME (move) -----------------------------------------------------
router.post("/rename", requireAdmin, async (req, res) => {
  if (!ensureSupabase(res)) return;
  try {
    const { fromPath, toName } = req.body;
    if (!fromPath || !toName) return res.status(400).json({ error: "fromPath and toName required" });

    const folder = fromPath.includes("/") ? fromPath.split("/").slice(0, -1).join("/") : "";
    const toPath = (folder ? `${folder}/` : "") + toName;

    // Use copy+remove for widest compatibility
    const copy = await supabase.storage.from(BUCKET).copy(fromPath, toPath);
    if (copy.error) throw copy.error;

    const del = await supabase.storage.from(BUCKET).remove([fromPath]);
    if (del.error) throw del.error;

    const oldUrl = publicUrl(fromPath);
    const newUrl = publicUrl(toPath);

    // Update references in both settings tables where values equal oldUrl
    const replacement = { fromPath, toPath, oldPublicUrl: oldUrl, newPublicUrl: newUrl };
    await replaceUrlInTable("settings_draft", replacement);
    await replaceUrlInTable("settings_public", replacement);

    try {
      await logAdminAction(req.user?.email || "unknown", "media.rename", {
        fromPath,
        toPath,
        oldUrl,
        newUrl,
      });
    } catch {}
    res.json({ success: true, fromPath, toPath, url: newUrl });
  } catch (err) {
    console.error("POST /api/storage/rename error:", err);
    res.status(500).json({ error: "Failed to rename" });
  }
});

export default router;
