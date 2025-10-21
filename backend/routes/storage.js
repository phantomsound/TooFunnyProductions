/* =========================================================================
   FILE: backend/routes/storage.js
   -------------------------------------------------------------------------
   Single-bucket media API with list/upload/rename/delete and
   URL reference updates inside settings_draft/settings_public.
   ========================================================================= */
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import { requireAdmin } from "../auth.js";
import { logAdminAction } from "../lib/audit.js";

const router = Router();
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

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

function publicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Replace any occurrences of oldUrl with newUrl in a settings table row
async function replaceUrlInTable(table, oldUrl, newUrl) {
  if (!supabase) return;
  const sel = await supabase.from(table).select("*").limit(1).maybeSingle();
  if (sel.error) throw sel.error;
  const row = sel.data;
  if (!row) return;

  let changed = false;
  const next = { ...row };
  for (const k of Object.keys(next)) {
    if (typeof next[k] === "string" && next[k] === oldUrl) {
      next[k] = newUrl;
      changed = true;
    }
  }
  if (!changed) return;

  const upd = await supabase.from(table).update({ ...next, updated_at: new Date().toISOString() }).eq("id", row.id);
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
    await replaceUrlInTable("settings_draft", oldUrl, newUrl);
    await replaceUrlInTable("settings_public", oldUrl, newUrl);

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
