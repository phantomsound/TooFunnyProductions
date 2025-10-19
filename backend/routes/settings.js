// backend/routes/settings.js
// ------------------------------------------------------------------
// Robust settings routes: singleton healing + column whitelist.
// ------------------------------------------------------------------
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "../auth.js";
import { logAdminAction } from "../lib/audit.js";

const router = Router();

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in backend/.env");
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

const TBL = (stage) => (stage === "draft" ? "settings_draft" : "settings_public");

// Only these keys may be written to either table.
// Add here when you introduce new columns.
const ALLOWED = new Set([
  "hero_title",
  "hero_subtext",
  "hero_image_url",
  "featured_video_url",

  "site_title",
  "site_description",
  "site_keywords",
  "logo_url",
  "favicon_url",
  "footer_text",

  "footer_links",       // jsonb []
  "contactemail",
  "contactphone",
  "contact_socials",    // jsonb []

  "maintenance_enabled",
  "maintenance_message",
  "maintenance_schedule_enabled",
  "maintenance_daily_start",
  "maintenance_daily_end",
  "maintenance_timezone",

  "theme_accent",

  "published_at",       // only on live; harmless to filter
  "updated_at"          // we set this on writes
]);

function filterAllowed(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && ALLOWED.has(k)) o[k] = v;
  }
  o.updated_at = new Date().toISOString();
  return o;
}

// Ensure we have exactly one usable row and return its UUID id.
// Picks the oldest row; if id is bad/empty/"null", repair it with randomUUID().
async function ensureSingleton(stage) {
  const table = TBL(stage);

  // Oldest row determines the singleton
  const sel = await supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (sel.error && sel.error.code !== "PGRST116") throw sel.error;

  if (!sel.data) {
    const ins = await supabase.from(table).insert([{}]).select("id").single();
    if (ins.error) throw ins.error;
    return ins.data.id;
  }

  let { id, created_at } = sel.data;
  const bad =
    !id ||
    String(id).trim() === "" ||
    String(id).toLowerCase() === "null" ||
    String(id).length !== 36;

  if (bad) {
    const newId = randomUUID();
    const fix = await supabase
      .from(table)
      .update({ id: newId })
      .eq("created_at", created_at) // target that exact row
      .select("id")
      .single();
    if (fix.error) throw fix.error;
    id = newId;
  }

  return id;
}

// -------------- Routes ----------------

// GET /api/settings?stage=live|draft (default live)
router.get("/", async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });
    const stage = req.query.stage === "draft" ? "draft" : "live";
    const table = TBL(stage);

    const sel = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;
    res.json(sel.data || {});
  } catch (err) {
    console.error("GET /api/settings error:", err);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

// PUT /api/settings?stage=live|draft (default draft) – admin only
router.put("/", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });
    const stage = req.query.stage === "live" ? "live" : "draft";
    const table = TBL(stage);

    const id = await ensureSingleton(stage);
    const payload = filterAllowed(req.body);

    const upd = await supabase.from(table).update(payload).eq("id", id).select("*").single();
    if (upd.error) throw upd.error;

    try {
      await logAdminAction(req.user?.email || "unknown", `settings.update.${stage}`, payload);
    } catch {}

    res.json({ success: true, data: upd.data });
  } catch (err) {
    console.error("PUT /api/settings error:", err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// POST /api/settings/pull-live – copy live → draft
router.post("/pull-live", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });

    const liveSel = await supabase
      .from("settings_public")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (liveSel.error && liveSel.error.code !== "PGRST116") throw liveSel.error;

    const src = filterAllowed(liveSel.data || {});
    const draftId = await ensureSingleton("draft");

    const upd = await supabase
      .from("settings_draft")
      .update(src)
      .eq("id", draftId)
      .select("*")
      .single();
    if (upd.error) throw upd.error;

    try {
      await logAdminAction(req.user?.email || "unknown", "settings.pull_live_to_draft");
    } catch {}

    res.json({ success: true, data: upd.data });
  } catch (err) {
    console.error("POST /api/settings/pull-live error:", err);
    res.status(500).json({ error: "Failed to pull live into draft" });
  }
});

// POST /api/settings/publish – copy draft → live
router.post("/publish", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });

    const liveId = await ensureSingleton("live");
    const draftId = await ensureSingleton("draft");

    const draft = await supabase.from("settings_draft").select("*").eq("id", draftId).single();
    if (draft.error) throw draft.error;

    const payload = filterAllowed(draft.data || {});
    payload.published_at = new Date().toISOString(); // will be ignored if column absent

    const upd = await supabase
      .from("settings_public")
      .update(payload)
      .eq("id", liveId)
      .select("*")
      .single();
    if (upd.error) throw upd.error;

    try {
      await logAdminAction(req.user?.email || "unknown", "settings.publish_draft_to_live");
    } catch {}

    res.json({ success: true, data: upd.data });
  } catch (err) {
    console.error("POST /api/settings/publish error:", err);
    res.status(500).json({ error: "Failed to publish draft to live" });
  }
});

// GET /api/settings/preview – read draft row for /?stage=draft
router.get("/preview", async (_req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });
    const sel = await supabase
      .from("settings_draft")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;
    res.json(sel.data || {});
  } catch (err) {
    console.error("GET /api/settings/preview error:", err);
    res.status(500).json({ error: "Failed to fetch draft preview" });
  }
});

export default router;
