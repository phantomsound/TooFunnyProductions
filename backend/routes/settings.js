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
  "who_title",
  "who_body",
  "who_cta_label",
  "who_cta_url",
  "who_image_url",

  "site_title",
  "site_description",
  "site_keywords",
  "logo_url",
  "favicon_url",
  "footer_text",

  "footer_links",       // jsonb []
  "admin_quick_links", // jsonb []
  "contactemail",
  "contactphone",
  "contact_socials",    // jsonb []

  "about_title",
  "about_body",
  "about_mission_title",
  "about_mission_body",
  "about_team_intro",
  "about_team",         // jsonb []

  "events_title",
  "events_intro",
  "events_upcoming",    // jsonb []
  "events_past",        // jsonb []

  "media_title",
  "media_intro",
  "media_sections",     // jsonb []

  "merch_title",
  "merch_intro",
  "merch_items",        // jsonb []

  "contact_title",
  "contact_intro",
  "contact_cards",      // jsonb []

  "maintenance_enabled",
  "maintenance_message",
  "maintenance_schedule_enabled",
  "maintenance_daily_start",
  "maintenance_daily_end",
  "maintenance_timezone",

  "theme_accent",
  "theme_bg",
  "header_bg",
  "footer_bg",

  "session_timeout_minutes",

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

function stripMetaFields(obj = {}) {
  const clone = { ...obj };
  delete clone.updated_at;
  delete clone.published_at;
  return clone;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function diffSettings(before = {}, after = {}) {
  const diff = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const prev = before?.[key];
    const next = after?.[key];
    if (safeJson(prev) !== safeJson(next)) {
      diff[key] = { before: prev ?? null, after: next ?? null };
    }
  }
  return diff;
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
    const prev = await supabase.from(table).select("*").eq("id", id).single();
    if (prev.error) throw prev.error;

    const payload = filterAllowed(req.body);

    const upd = await supabase.from(table).update(payload).eq("id", id).select("*").single();
    if (upd.error) throw upd.error;

    try {
      const before = stripMetaFields(filterAllowed(prev.data || {}));
      const after = stripMetaFields(payload);
      const changed = diffSettings(before, after);
      await logAdminAction(req.user?.email || "unknown", `settings.update.${stage}`, {
        stage,
        changed,
        changedKeys: Object.keys(changed),
      });
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
      await logAdminAction(req.user?.email || "unknown", "settings.pull_live_to_draft", {
        copiedKeys: Object.keys(stripMetaFields(src)),
      });
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

    const livePrev = await supabase.from("settings_public").select("*").eq("id", liveId).single();
    if (livePrev.error) throw livePrev.error;

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
      const before = stripMetaFields(filterAllowed(livePrev.data || {}));
      const after = stripMetaFields(payload);
      const changed = diffSettings(before, after);
      await logAdminAction(req.user?.email || "unknown", "settings.publish_draft_to_live", {
        changed,
        changedKeys: Object.keys(changed),
        published_at: payload.published_at,
      });
    } catch {}

    res.json({ success: true, data: upd.data });
  } catch (err) {
    console.error("POST /api/settings/publish error:", err);
    res.status(500).json({ error: "Failed to publish draft to live" });
  }
});

router.get("/lock", requireAdmin, async (_req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });

    const sel = await supabase.from("settings_lock").select("*").eq("id", 1).maybeSingle();
    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;

    if (!sel.data) {
      await supabase.from("settings_lock").insert([{ id: 1 }]);
      return res.json({ lock: null, locked: false });
    }

    const row = sel.data;
    const expires = row.expires_at ? new Date(row.expires_at) : null;
    const expired = !expires || expires.getTime() < Date.now();

    if (expired) {
      return res.json({ lock: null, locked: false });
    }

    res.json({
      locked: true,
      lock: {
        holder_email: row.holder_email,
        acquired_at: row.acquired_at,
        expires_at: row.expires_at,
      },
    });
  } catch (err) {
    console.error("GET /api/settings/lock error:", err);
    res.status(500).json({ error: "Failed to read lock" });
  }
});

router.post("/lock/acquire", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });

    const ttlSeconds = Number(req.body?.ttlSeconds) || 300;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const email = (req.user?.email || "unknown").toLowerCase();

    const sel = await supabase.from("settings_lock").select("*").eq("id", 1).maybeSingle();
    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;

    let row = sel.data;
    if (!row) {
      const inserted = await supabase
        .from("settings_lock")
        .insert([
          {
            id: 1,
            holder_email: email,
            acquired_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
          },
        ])
        .select("*")
        .single();
      if (inserted.error) throw inserted.error;
      row = inserted.data;
    } else {
      const currentHolder = (row.holder_email || "").toLowerCase();
      const expires = row.expires_at ? new Date(row.expires_at) : null;
      const expired = !expires || expires.getTime() < Date.now();

      if (!expired && currentHolder && currentHolder !== email) {
        return res.status(423).json({
          error: `Draft locked by ${currentHolder}`,
          lock: {
            holder_email: row.holder_email,
            acquired_at: row.acquired_at,
            expires_at: row.expires_at,
          },
        });
      }

      const update = await supabase
        .from("settings_lock")
        .update({
          holder_email: email,
          acquired_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .eq("id", 1)
        .select("*")
        .single();
      if (update.error) throw update.error;
      row = update.data;
    }

    try {
      await logAdminAction(email, "settings.lock.acquire", { expires_at: row.expires_at });
    } catch {}

    res.json({
      locked: true,
      lock: {
        holder_email: row.holder_email,
        acquired_at: row.acquired_at,
        expires_at: row.expires_at,
      },
    });
  } catch (err) {
    console.error("POST /api/settings/lock/acquire error:", err);
    res.status(500).json({ error: "Failed to acquire lock" });
  }
});

router.post("/lock/release", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });

    const email = (req.user?.email || "unknown").toLowerCase();
    const sel = await supabase.from("settings_lock").select("*").eq("id", 1).maybeSingle();
    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;

    if (!sel.data) {
      return res.json({ lock: null, locked: false });
    }

    const currentHolder = (sel.data.holder_email || "").toLowerCase();
    const expires = sel.data.expires_at ? new Date(sel.data.expires_at) : null;
    const expired = !expires || expires.getTime() < Date.now();

    if (currentHolder && currentHolder !== email && !expired) {
      return res.status(423).json({
        error: `Draft still locked by ${currentHolder}`,
        lock: {
          holder_email: sel.data.holder_email,
          acquired_at: sel.data.acquired_at,
          expires_at: sel.data.expires_at,
        },
      });
    }

    const update = await supabase
      .from("settings_lock")
      .update({ holder_email: null, acquired_at: null, expires_at: null })
      .eq("id", 1)
      .select("*")
      .single();
    if (update.error) throw update.error;

    try {
      await logAdminAction(email, "settings.lock.release");
    } catch {}

    res.json({ lock: null, locked: false });
  } catch (err) {
    console.error("POST /api/settings/lock/release error:", err);
    res.status(500).json({ error: "Failed to release lock" });
  }
});

router.get("/versions", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const stageFilter = req.query.stage === "live" ? "live" : req.query.stage === "draft" ? "draft" : null;

    let query = supabase
      .from("settings_versions")
      .select("id, stage, label, author_email, created_at, status")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (stageFilter) query = query.eq("stage", stageFilter);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ versions: data || [] });
  } catch (err) {
    console.error("GET /api/settings/versions error:", err);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

router.post("/versions", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });
    const stage = req.body?.stage === "live" ? "live" : "draft";
    const label = typeof req.body?.label === "string" && req.body.label.trim().length > 0 ? req.body.label.trim() : null;
    const email = (req.user?.email || "unknown").toLowerCase();

    const table = TBL(stage);
    const sel = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;

    const snapshot = filterAllowed(sel.data || {});

    const insert = await supabase
      .from("settings_versions")
      .insert([
        {
          stage,
          label,
          author_email: email,
          data: snapshot,
        },
      ])
      .select("id, stage, label, author_email, created_at, status")
      .single();
    if (insert.error) throw insert.error;

    try {
      await logAdminAction(email, "settings.version.create", {
        stage,
        label,
        snapshotKeys: Object.keys(stripMetaFields(snapshot)),
      });
    } catch {}

    res.json({ success: true, version: insert.data });
  } catch (err) {
    console.error("POST /api/settings/versions error:", err);
    res.status(500).json({ error: "Failed to create version" });
  }
});

router.post("/versions/:id/restore", requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured." });
    const versionId = req.params.id;
    const email = (req.user?.email || "unknown").toLowerCase();

    const version = await supabase
      .from("settings_versions")
      .select("id, stage, data, label, author_email, created_at")
      .eq("id", versionId)
      .single();
    if (version.error) {
      if (version.error.code === "PGRST116") return res.status(404).json({ error: "Version not found" });
      throw version.error;
    }

    const payload = filterAllowed(version.data.data || {});
    const draftId = await ensureSingleton("draft");

    const upd = await supabase
      .from("settings_draft")
      .update(payload)
      .eq("id", draftId)
      .select("*")
      .single();
    if (upd.error) throw upd.error;

    try {
      await logAdminAction(email, "settings.version.restore", {
        versionId,
        stage: version.data.stage,
        label: version.data.label,
      });
    } catch {}

    res.json({ success: true, data: upd.data });
  } catch (err) {
    console.error("POST /api/settings/versions/:id/restore error:", err);
    res.status(500).json({ error: "Failed to restore version" });
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
