/* =========================================================================
   FILE: backend/routes/storage.js
   -------------------------------------------------------------------------
   Single-bucket media API with list/upload/rename/delete and
   URL reference updates inside settings_draft/settings_public.
   ========================================================================= */
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../auth.js";
import { logAdminAction } from "../lib/audit.js";

const router = Router();
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

const BUCKET = "media";

// Build public URL from path
function publicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Replace any occurrences of oldUrl with newUrl in a settings table row
async function replaceUrlInTable(table, oldUrl, newUrl) {
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
  try {
    const { prefix = "", limit = 1000 } = req.query;
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix || "", {
      limit: Number(limit) || 1000,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw error;

    // hide any legacy folders named 'uploads' or 'incoming'
    const filtered = (data || []).filter((item) => item.name !== "uploads" && item.name !== "incoming");

    const items = filtered.map((f) => ({
      name: f.name,
      path: (prefix ? `${prefix}/` : "") + f.name,
      size: f.metadata?.size ?? null,
      created_at: f.created_at ?? null,
      updated_at: f.updated_at ?? null,
      url: publicUrl((prefix ? `${prefix}/` : "") + f.name),
      isDir: !!f.id && f.name && f.metadata == null && f.created_at == null, // storage marks folders with null meta
    }));

    res.json({ items });
  } catch (err) {
    console.error("GET /api/storage/list error:", err);
    res.status(500).json({ error: "Failed to list" });
  }
});

// --- UPLOAD ------------------------------------------------------------
router.post("/upload", requireAdmin, async (req, res) => {
  try {
    // Expecting multipart/form-data; ensure your server.js has a body-parser for it or use raw buffer.
    // Here we assume you've already attached something like express-fileupload or multer.
    const file = req.files?.file; // if using express-fileupload
    if (!file) return res.status(400).json({ error: "No file" });

    const filePath = `${Date.now()}_${file.name}`; // root of bucket
    const { data, error } = await supabase.storage.from(BUCKET).upload(filePath, file.data, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) throw error;

    const url = publicUrl(data.path);
    try { await logAdminAction(req.user?.email || "unknown", "media.upload", { path: data.path }); } catch {}
    res.json({ path: data.path, url });
  } catch (err) {
    console.error("POST /api/storage/upload error:", err);
    res.status(500).json({ error: "Failed to upload" });
  }
});

// --- DELETE ------------------------------------------------------------
router.post("/delete", requireAdmin, async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: "path required" });

    const oldUrl = publicUrl(path);
    const del = await supabase.storage.from(BUCKET).remove([path]);
    if (del.error) throw del.error;

    try { await logAdminAction(req.user?.email || "unknown", "media.delete", { path }); } catch {}
    // We don't auto-clear references on delete (safer); UI should warn.
    res.json({ success: true, deleted: path, oldUrl });
  } catch (err) {
    console.error("POST /api/storage/delete error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// --- RENAME (move) -----------------------------------------------------
router.post("/rename", requireAdmin, async (req, res) => {
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

    try { await logAdminAction(req.user?.email || "unknown", "media.rename", { fromPath, toPath }); } catch {}
    res.json({ success: true, fromPath, toPath, url: newUrl });
  } catch (err) {
    console.error("POST /api/storage/rename error:", err);
    res.status(500).json({ error: "Failed to rename" });
  }
});

export default router;
