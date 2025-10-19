// backend/routes/admin.js
import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { createClient } from "@supabase/supabase-js";
import { logAdminAction } from "../lib/audit.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const router = Router();

// POST /api/admin/publish  -> copy draft row into public and stamp published_at
router.post("/publish", requireAdmin, async (req, res) => {
  try {
    const { data: draft, error } = await supabase.from("settings_draft").select("*").limit(1).maybeSingle();
    if (error) throw error;

    if (!draft) return res.status(400).json({ error: "No draft row to publish." });

    const { id, ...rest } = draft;
    const payload = { ...rest, updated_at: new Date().toISOString(), published_at: new Date().toISOString() };

    const up = await supabase
      .from("settings_public")
      .upsert([{ ...payload }], { onConflict: "id" })   // id will be auto if public row doesn't exist
      .select("*")
      .limit(1)
      .maybeSingle();

    if (up.error) throw up.error;

    try { await logAdminAction(req.user?.email || "unknown", "settings.publish", { to: "live" }); } catch {}

    res.json({ success: true, data: up.data });
  } catch (e) {
    console.error("Publish error:", e);
    res.status(500).json({ error: "Failed to publish" });
  }
});

export default router;
