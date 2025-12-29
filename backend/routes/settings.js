// backend/routes/settings.js
// ------------------------------------------------------------------
// Robust settings routes: singleton healing + column whitelist.
// ------------------------------------------------------------------
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdmin } from "../auth.js";
import { logAdminAction } from "../lib/audit.js";
import { getSupabaseServiceContext } from "../lib/supabaseClient.js";

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DEFAULT_SETTINGS_PATH = join(DATA_DIR, "settings.json");
const LOCAL_SETTINGS_PATH = join(DATA_DIR, "settings.local.json");

async function readJsonFile(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.name === "SyntaxError")) {
      if (err.code !== "ENOENT") {
        const message = err?.message ? `: ${err.message}` : "";
        console.warn(`⚠️ Failed to parse ${path}${message}; ignoring override.`);
      }
      return null;
    }
    throw err;
  }
}

async function loadLocalSettings() {
  const override = await readJsonFile(LOCAL_SETTINGS_PATH);
  if (override && typeof override === "object") return override;
  const fallback = await readJsonFile(DEFAULT_SETTINGS_PATH);
  return (fallback && typeof fallback === "object" ? fallback : {}) ?? {};
}

async function getSupabaseContext() {
  const context = await getSupabaseServiceContext();
  if (!context.supabaseUrl || !context.serviceKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in backend/.env");
  }
  return {
    supabase: context.client,
    supabaseIsLocal: context.supabaseIsLocal,
    supabaseHasRequiredRole: context.hasServiceRole,
  };
}

async function getSupabaseOrThrow() {
  const { supabase } = await getSupabaseContext();
  if (!supabase) throw new Error("Supabase not configured.");
  return supabase;
}

async function ensureSupabaseWritable(res) {
  const { supabase, supabaseIsLocal, supabaseHasRequiredRole } = await getSupabaseContext();
  if (!supabase) {
    res.status(500).json({ error: "Supabase not configured." });
    return null;
  }
  if (!supabaseHasRequiredRole) {
    res.status(500).json({
      error: supabaseIsLocal
        ? "Local PostgREST requires a JWT in SUPABASE_SERVICE_KEY that matches your PGRST_JWT_SECRET. Update backend/.env and restart the service."
        : "Supabase service role key required. Update SUPABASE_SERVICE_KEY in backend/.env with the service_role key from your PostgREST stack.",
    });
    return null;
  }
  return supabase;
}

const TBL = (stage) => (stage === "draft" ? "settings_draft" : "settings_public");

const VERSION_KIND_DRAFT = "draft";
const VERSION_KIND_AUTOSAVE = "autosave";
const VERSION_KIND_PUBLISHED = "published";

const VERSION_STATUS_ACTIVE = "active";
const VERSION_STATUS_ARCHIVED = "archived";

const SNAPSHOT_LIMITS = {
  [VERSION_KIND_DRAFT]: 20,
  [VERSION_KIND_AUTOSAVE]: 20,
  [VERSION_KIND_PUBLISHED]: 10,
};

const VERSION_KINDS_FOR_LIMIT = new Set([VERSION_KIND_DRAFT, VERSION_KIND_AUTOSAVE, VERSION_KIND_PUBLISHED]);

const ACTIVE_VERSION_KINDS = new Set([VERSION_KIND_DRAFT, VERSION_KIND_AUTOSAVE, VERSION_KIND_PUBLISHED]);

const clampLimit = (value, fallback = 20) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), 200);
};

const windowsOverlap = (aStart, aEnd, bStart, bEnd) => {
  const aS = aStart?.getTime?.() ?? null;
  const aE = aEnd?.getTime?.() ?? null;
  const bS = bStart?.getTime?.() ?? null;
  const bE = bEnd?.getTime?.() ?? null;

  if (aS === null || bS === null) return false;
  const aEndMs = aE ?? Number.POSITIVE_INFINITY;
  const bEndMs = bE ?? Number.POSITIVE_INFINITY;
  return aS < bEndMs && bS < aEndMs;
};

const mapVersionRow = (row = {}) => ({
  id: row.id,
  stage: row.stage,
  label: row.label,
  note: row.note,
  author_email: row.author_email,
  created_at: row.created_at,
  updated_at: row.updated_at,
  status: row.status,
  kind: row.kind || VERSION_KIND_DRAFT,
  published_at: row.published_at,
  is_default: Boolean(row.is_default),
});

const mapLockRow = (row = {}) => ({
  holder_email: row.holder_email || null,
  acquired_at: row.acquired_at || null,
  expires_at: row.expires_at || null,
  active_version_id: row.active_version_id || null,
  source_version_id: row.source_version_id || null,
  auto_saved_version_id: row.auto_saved_version_id || null,
});

const normalizeKind = (kind) => {
  if (!kind || typeof kind !== "string") return VERSION_KIND_DRAFT;
  const trimmed = kind.trim().toLowerCase();
  if (trimmed === VERSION_KIND_DRAFT) return VERSION_KIND_DRAFT;
  if (trimmed === VERSION_KIND_AUTOSAVE) return VERSION_KIND_AUTOSAVE;
  if (trimmed === VERSION_KIND_PUBLISHED) return VERSION_KIND_PUBLISHED;
  return VERSION_KIND_DRAFT;
};

const getLimitForKind = (kind) => SNAPSHOT_LIMITS[normalizeKind(kind)] ?? 20;

async function fetchVersionById(id, { includeData = false } = {}) {
  if (!id) return null;
  const supabase = await getSupabaseOrThrow();
  const columns = [
    "id",
    "stage",
    "label",
    "note",
    "author_email",
    "status",
    "kind",
    "created_at",
    "updated_at",
    "published_at",
    "is_default",
  ];
  if (includeData) columns.push("data");

  const sel = await supabase
    .from("settings_versions")
    .select(columns.join(", "))
    .eq("id", id)
    .maybeSingle();

  if (sel.error) throw sel.error;
  if (!sel.data) return null;

  const version = mapVersionRow(sel.data);
  if (includeData) {
    version.data = filterAllowed(sel.data.data || {});
  }
  return version;
}

async function listVersionsInternal({
  kind,
  stage,
  status = VERSION_STATUS_ACTIVE,
  limit = 50,
  includeData = false,
} = {}) {
  const supabase = await getSupabaseOrThrow();

  let query = supabase
    .from("settings_versions")
    .select(
      [
        "id",
        "stage",
        "label",
        "note",
        "author_email",
        "status",
        "kind",
        "created_at",
        "updated_at",
        "published_at",
        "is_default",
        includeData ? "data" : null,
      ]
        .filter(Boolean)
        .join(", ")
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(clampLimit(limit, 50));

  if (kind) {
    const normalized = normalizeKind(kind);
    if (normalized === VERSION_KIND_PUBLISHED) {
      query = query.eq("kind", VERSION_KIND_PUBLISHED);
    } else if (normalized === VERSION_KIND_AUTOSAVE) {
      query = query.eq("kind", VERSION_KIND_AUTOSAVE);
    } else {
      query = query.in("kind", [VERSION_KIND_DRAFT, VERSION_KIND_AUTOSAVE]);
    }
  }

  if (stage) {
    query = query.eq("stage", stage);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => {
    const version = mapVersionRow(row);
    if (includeData) {
      version.data = filterAllowed(row.data || {});
    }
    return version;
  });
}

async function enforceVersionLimits(kind) {
  const supabase = await getSupabaseOrThrow();
  const normalized = normalizeKind(kind);
  if (!VERSION_KINDS_FOR_LIMIT.has(normalized)) return;

  const limit = getLimitForKind(normalized);

  const { data, error } = await supabase
    .from("settings_versions")
    .select("id, kind, created_at")
    .eq("status", VERSION_STATUS_ACTIVE)
    .in(
      "kind",
      normalized === VERSION_KIND_PUBLISHED
        ? [VERSION_KIND_PUBLISHED]
        : [VERSION_KIND_DRAFT, VERSION_KIND_AUTOSAVE]
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = data || [];
  if (rows.length <= limit) return;

  const excess = rows.slice(limit);
  const ids = excess.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) return;

  await supabase
    .from("settings_versions")
    .update({ status: VERSION_STATUS_ARCHIVED })
    .in("id", ids);
}

async function markDefaultSnapshot(snapshotId, actorEmail) {
  const supabase = await getSupabaseOrThrow();
  if (!snapshotId) throw new Error("Missing snapshot id");

  const now = new Date().toISOString();

  const reset = await supabase
    .from("settings_versions")
    .update({ is_default: false, updated_at: now })
    .eq("is_default", true);
  if (reset.error) throw reset.error;

  const upd = await supabase
    .from("settings_versions")
    .update({ is_default: true, updated_at: now })
    .eq("id", snapshotId)
    .select("id, label, stage, kind, note, updated_at")
    .single();
  if (upd.error) throw upd.error;

  try {
    await logAdminAction(actorEmail || "unknown", "settings.snapshot.set_default", {
      snapshotId,
      label: upd.data.label,
      kind: upd.data.kind,
    });
  } catch (err) {
    console.warn("Failed to log default snapshot", err?.message || err);
  }

  return mapVersionRow(upd.data);
}

async function insertVersion({
  stage = "draft",
  kind = VERSION_KIND_DRAFT,
  label = null,
  note = null,
  authorEmail,
  data = {},
  status = VERSION_STATUS_ACTIVE,
  publishedAt = null,
}) {
  const supabase = await getSupabaseOrThrow();

  const normalizedKind = normalizeKind(kind);
  const payload = {
    stage,
    kind: normalizedKind,
    status,
    label,
    note,
    author_email: authorEmail || null,
    data: filterAllowed(data || {}),
    published_at: publishedAt,
    updated_at: new Date().toISOString(),
  };

  const insert = await supabase
    .from("settings_versions")
    .insert([payload])
    .select(
      "id, stage, label, note, author_email, status, kind, created_at, updated_at, published_at, is_default"
    )
    .single();
  if (insert.error) throw insert.error;

  await enforceVersionLimits(normalizedKind);

  return mapVersionRow(insert.data);
}

async function updateVersionMetadata(id, { label, note, status, kind, isDefault, actorEmail }) {
  const supabase = await getSupabaseOrThrow();
  if (!id) throw new Error("Missing version id");

  const patch = { updated_at: new Date().toISOString() };
  if (label !== undefined) patch.label = label;
  if (note !== undefined) patch.note = note;
  if (status !== undefined) patch.status = status;
  if (kind !== undefined) patch.kind = normalizeKind(kind);
  if (isDefault === true) {
    await markDefaultSnapshot(id, actorEmail);
    return fetchVersionById(id);
  }
  if (isDefault === false) patch.is_default = false;

  const upd = await supabase
    .from("settings_versions")
    .update(patch)
    .eq("id", id)
    .select(
      "id, stage, label, note, author_email, status, kind, created_at, updated_at, published_at, is_default"
    )
    .single();
  if (upd.error) throw upd.error;

  if (patch.kind) {
    await enforceVersionLimits(patch.kind);
  }

  return mapVersionRow(upd.data);
}

async function updateVersionData(id, data) {
  const supabase = await getSupabaseOrThrow();
  if (!id) throw new Error("Missing version id");
  const clean = filterAllowed(data || {});
  const upd = await supabase
    .from("settings_versions")
    .update({ data: clean, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(
      "id, stage, label, note, author_email, status, kind, created_at, updated_at, published_at, is_default"
    )
    .single();
  if (upd.error) throw upd.error;
  return mapVersionRow(upd.data);
}

const DEPLOYMENT_STATUS_SCHEDULED = "scheduled";
const DEPLOYMENT_STATUS_RUNNING = "running";
const DEPLOYMENT_STATUS_COMPLETED = "completed";
const DEPLOYMENT_STATUS_CANCELLED = "cancelled";

async function getDefaultSnapshot() {
  const supabase = await getSupabaseOrThrow();
  const sel = await supabase
    .from("settings_versions")
    .select(
      "id, stage, label, note, author_email, status, kind, created_at, updated_at, published_at, is_default, data"
    )
    .eq("is_default", true)
    .eq("status", VERSION_STATUS_ACTIVE)
    .limit(1)
    .maybeSingle();
  if (sel.error) throw sel.error;
  if (!sel.data) return null;
  const version = mapVersionRow(sel.data);
  version.data = filterAllowed(sel.data.data || {});
  return version;
}

async function applySnapshotToStage(versionId, stage, actorEmail, reason) {
  const supabase = await getSupabaseOrThrow();
  if (!versionId) throw new Error("Missing snapshot id");
  const version = await fetchVersionById(versionId, { includeData: true });
  if (!version) throw new Error("Snapshot not found");

  const targetId = await ensureSingleton(stage);
  const payload = filterAllowed(version.data || {});
  if (stage === "live") {
    payload.published_at = new Date().toISOString();
  }

  const upd = await supabase
    .from(TBL(stage))
    .update(payload)
    .eq("id", targetId)
    .select("*")
    .single();
  if (upd.error) throw upd.error;

  try {
    await logAdminAction(actorEmail || "system", `settings.apply_${stage}_snapshot`, {
      snapshotId: versionId,
      label: version.label,
      reason,
    });
  } catch (err) {
    console.warn("Failed to log snapshot application", err?.message || err);
  }

  return { version, data: upd.data };
}

async function listDeployments({ status, includePast = false } = {}) {
  const supabase = await getSupabaseOrThrow();
  let query = supabase
    .from("settings_deployments")
    .select(
      [
        "id",
        "snapshot_id",
        "fallback_snapshot_id",
        "start_at",
        "end_at",
        "status",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "cancelled_at",
        "cancelled_by",
        "override_reason",
        "activated_at",
        "completed_at",
      ].join(", ")
    )
    .order("start_at", { ascending: true });

  if (status) {
    query = query.eq("status", status);
  } else if (!includePast) {
    query = query.in("status", [DEPLOYMENT_STATUS_SCHEDULED, DEPLOYMENT_STATUS_RUNNING]);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadDeployment(id) {
  const supabase = await getSupabaseOrThrow();
  if (!id) throw new Error("Missing deployment id");
  const sel = await supabase
    .from("settings_deployments")
    .select(
      [
        "id",
        "snapshot_id",
        "fallback_snapshot_id",
        "start_at",
        "end_at",
        "status",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "cancelled_at",
        "cancelled_by",
        "override_reason",
        "activated_at",
        "completed_at",
      ].join(", ")
    )
    .eq("id", id)
    .maybeSingle();
  if (sel.error) throw sel.error;
  return sel.data || null;
}

async function processDeploymentSchedule() {
  const supabase = await getSupabaseOrThrow();

  const now = new Date();
  const nowIso = now.toISOString();

  let deployments;
  try {
    deployments = await listDeployments();
  } catch (err) {
    console.error("Failed to load deployment schedule:", err?.message || err);
    return;
  }

  for (const deployment of deployments) {
    try {
      const status = deployment.status;
      if (status === DEPLOYMENT_STATUS_CANCELLED || status === DEPLOYMENT_STATUS_COMPLETED) continue;

      const startAt = deployment.start_at ? new Date(deployment.start_at) : null;
      const endAt = deployment.end_at ? new Date(deployment.end_at) : null;

      if (status === DEPLOYMENT_STATUS_SCHEDULED && startAt && startAt <= now) {
        await applySnapshotToStage(deployment.snapshot_id, "live", deployment.created_by, "scheduled_start");
        const upd = await supabase
          .from("settings_deployments")
          .update({
            status: DEPLOYMENT_STATUS_RUNNING,
            activated_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", deployment.id);
        if (upd.error) throw upd.error;
        try {
          await logAdminAction(deployment.created_by || "system", "settings.schedule.started", {
            deploymentId: deployment.id,
            snapshotId: deployment.snapshot_id,
          });
        } catch (err) {
          console.warn("Failed to log schedule start", err?.message || err);
        }
      } else if (status === DEPLOYMENT_STATUS_RUNNING) {
        const shouldEnd = endAt && endAt <= now;
        if (shouldEnd) {
          let fallback = deployment.fallback_snapshot_id;
          if (!fallback) {
            const defaultSnapshot = await getDefaultSnapshot();
            fallback = defaultSnapshot?.id || null;
          }
          if (fallback) {
            await applySnapshotToStage(fallback, "live", deployment.updated_by || deployment.created_by, "scheduled_end");
          }
          const upd = await supabase
            .from("settings_deployments")
            .update({
              status: DEPLOYMENT_STATUS_COMPLETED,
              updated_at: nowIso,
              completed_at: nowIso,
            })
            .eq("id", deployment.id);
          if (upd.error) throw upd.error;
          try {
            await logAdminAction(deployment.updated_by || deployment.created_by || "system", "settings.schedule.completed", {
              deploymentId: deployment.id,
              snapshotId: deployment.snapshot_id,
              fallbackSnapshotId: fallback,
            });
          } catch (err) {
            console.warn("Failed to log schedule completion", err?.message || err);
          }
        }
      }
    } catch (err) {
      console.error(
        `Failed to process deployment ${deployment?.id || "unknown"}:`,
        err?.message || err
      );
    }
  }
}

async function writeDraftSettings(data) {
  const supabase = await getSupabaseOrThrow();
  const draftId = await ensureSingleton("draft");
  const payload = filterAllowed(data || {});
  const upd = await supabase
    .from("settings_draft")
    .update(payload)
    .eq("id", draftId)
    .select("*")
    .single();
  if (upd.error) throw upd.error;
  return upd.data;
}

// Only these keys may be written to either table.
// Add here when you introduce new columns.
const ALLOWED = new Set([
  "hero_title",
  "hero_subtext",
  "hero_title_size",
  "hero_subtext_size",
  "hero_badge_size",
  "hero_title_font_size",
  "hero_subtext_font_size",
  "hero_badge_font_size",
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
  "admin_profiles",    // jsonb []
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
  "theme_use_global",

  "session_timeout_minutes",

  "published_at",       // only on live; harmless to filter
  "updated_at"          // we set this on writes
]);

const SIZE_FIELDS = new Set(["hero_title_size", "hero_subtext_size", "hero_badge_size"]);
const FONT_SIZE_FIELDS = new Set([
  "hero_title_font_size",
  "hero_subtext_font_size",
  "hero_badge_font_size",
]);

const coerceSize = (value) => {
  if (value === null) return "medium";
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "small" || trimmed === "medium" || trimmed === "large") {
      return trimmed;
    }
  }
  return "medium";
};

const FONT_SIZE_SIMPLE = /^\d+(?:\.\d+)?(?:rem|em|px|vw|vh|ch|%)$/i;
const FONT_SIZE_FUNCTION = /^(?:clamp|min|max|calc)\(\s*[-+0-9a-z.%\s,/*()]+\)$/i;
const FONT_SIZE_VAR = /^var\(\s*--[a-z0-9_-]+(?:\s*,\s*[-+0-9a-z.%\s,/*()]+)?\s*\)$/i;

const coerceFontSize = (value) => {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  if (FONT_SIZE_SIMPLE.test(trimmed)) return trimmed;
  if (FONT_SIZE_FUNCTION.test(trimmed)) return trimmed;
  if (FONT_SIZE_VAR.test(trimmed)) return trimmed;
  return null;
};

function filterAllowed(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || !ALLOWED.has(k)) continue;
    if (SIZE_FIELDS.has(k)) {
      o[k] = coerceSize(v);
    } else if (FONT_SIZE_FIELDS.has(k)) {
      o[k] = coerceFontSize(v);
    } else {
      o[k] = v;
    }
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
  const supabase = await getSupabaseOrThrow();
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
    const { supabase } = await getSupabaseContext();
    if (!supabase) {
      const localSettings = await loadLocalSettings();
      return res.json(stripMetaFields(localSettings));
    }
    await processDeploymentSchedule();
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
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    await processDeploymentSchedule();
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
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    await processDeploymentSchedule();

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
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    await processDeploymentSchedule();

    const actor = (req.user?.email || "unknown").toLowerCase();
    const snapshotId = req.body?.snapshotId ? String(req.body.snapshotId) : null;
    const publishLabelRaw = typeof req.body?.label === "string" ? req.body.label : null;
    const publishNoteRaw = typeof req.body?.note === "string" ? req.body.note : null;
    const setDefault = Boolean(req.body?.setDefault);

    const publishedAt = new Date().toISOString();

    let liveResult = null;
    let publishData = null;
    let publishLabel = publishLabelRaw ? publishLabelRaw.trim() : null;
    let publishNote = publishNoteRaw ? publishNoteRaw.trim() : null;

    if (snapshotId) {
      const result = await applySnapshotToStage(snapshotId, "live", actor, "manual_publish_snapshot");
      liveResult = result.data;
      publishData = stripMetaFields(result.version.data || {});
      if (!publishLabel) publishLabel = result.version.label || "Snapshot publish";
      if (!publishNote && result.version.note) publishNote = result.version.note;
    } else {
      const liveId = await ensureSingleton("live");
      const draftId = await ensureSingleton("draft");

      const draft = await supabase.from("settings_draft").select("*").eq("id", draftId).single();
      if (draft.error) throw draft.error;

      const livePrev = await supabase.from("settings_public").select("*").eq("id", liveId).single();
      if (livePrev.error) throw livePrev.error;

      const payload = filterAllowed(draft.data || {});
      payload.published_at = publishedAt;

      const upd = await supabase
        .from("settings_public")
        .update(payload)
        .eq("id", liveId)
        .select("*")
        .single();
      if (upd.error) throw upd.error;

      liveResult = upd.data;
      publishData = stripMetaFields(payload);

      try {
        const before = stripMetaFields(filterAllowed(livePrev.data || {}));
        const after = stripMetaFields(payload);
        const changed = diffSettings(before, after);
        await logAdminAction(actor, "settings.publish_draft_to_live", {
          changed,
          changedKeys: Object.keys(changed),
          published_at: payload.published_at,
        });
      } catch (err) {
        console.warn("Failed to log publish diff", err?.message || err);
      }
    }

    if (!publishData) publishData = {};
    const stored = await insertVersion({
      stage: "live",
      kind: VERSION_KIND_PUBLISHED,
      label: publishLabel || "Manual publish",
      note: publishNote || null,
      authorEmail: actor,
      data: publishData,
      status: VERSION_STATUS_ACTIVE,
      publishedAt,
    });

    let publishedSnapshot = stored;
    if (setDefault) {
      publishedSnapshot = await markDefaultSnapshot(stored.id, actor);
    }

    res.json({ success: true, data: liveResult, publishedSnapshot });
  } catch (err) {
    console.error("POST /api/settings/publish error:", err);
    res.status(500).json({ error: "Failed to publish draft to live" });
  }
});

router.get("/lock", requireAdmin, async (_req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;

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

    const lock = mapLockRow(row);
    const [activeVersion, sourceVersion, autoSavedVersion] = await Promise.all([
      lock.active_version_id ? fetchVersionById(lock.active_version_id) : Promise.resolve(null),
      lock.source_version_id ? fetchVersionById(lock.source_version_id) : Promise.resolve(null),
      lock.auto_saved_version_id ? fetchVersionById(lock.auto_saved_version_id) : Promise.resolve(null),
    ]);

    if (activeVersion) lock.active_version = activeVersion;
    if (sourceVersion) lock.source_version = sourceVersion;
    if (autoSavedVersion) lock.auto_saved_version = autoSavedVersion;

    res.json({
      locked: true,
      lock,
    });
  } catch (err) {
    console.error("GET /api/settings/lock error:", err);
    res.status(500).json({ error: "Failed to read lock" });
  }
});

router.get("/lock/options", requireAdmin, async (_req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;

    const [drafts, published, defaultSnapshot] = await Promise.all([
      listVersionsInternal({ kind: VERSION_KIND_DRAFT, stage: "draft", limit: 40 }),
      listVersionsInternal({ kind: VERSION_KIND_PUBLISHED, stage: "live", limit: 20 }),
      getDefaultSnapshot().catch((err) => {
        console.warn("Failed to load default snapshot", err?.message || err);
        return null;
      }),
    ]);

    res.json({
      drafts,
      published,
      defaultSnapshot,
    });
  } catch (err) {
    console.error("GET /api/settings/lock/options error:", err);
    res.status(500).json({ error: "Failed to load lock options" });
  }
});

router.post("/lock/acquire", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;

    const ttlSeconds = Number(req.body?.ttlSeconds) || 300;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const expiresAtIso = expiresAt.toISOString();
    const email = (req.user?.email || "unknown").toLowerCase();
    const selection = req.body?.selection || null;

    const sel = await supabase.from("settings_lock").select("*").eq("id", 1).maybeSingle();
    if (sel.error && sel.error.code !== "PGRST116") throw sel.error;

    let row = sel.data;
    if (!row) {
      const inserted = await supabase.from("settings_lock").insert([{ id: 1 }]).select("*").single();
      if (inserted.error) throw inserted.error;
      row = inserted.data;
    }

    const currentHolder = (row.holder_email || "").toLowerCase();
    const expires = row.expires_at ? new Date(row.expires_at) : null;
    const expired = !expires || expires.getTime() < Date.now();

    if (currentHolder === email && !expired && !selection) {
      const update = await supabase
        .from("settings_lock")
        .update({ expires_at: expiresAtIso })
        .eq("id", 1)
        .select("*")
        .single();
      if (update.error) throw update.error;
      const lock = mapLockRow(update.data);
      return res.json({ locked: true, lock });
    }

    if (!expired && currentHolder && currentHolder !== email) {
      return res.status(423).json({
        error: `Draft locked by ${currentHolder}`,
        lock: mapLockRow(row),
      });
    }

    if (!selection || typeof selection.mode !== "string") {
      return res.status(400).json({ error: "Selection required to acquire lock" });
    }

    const mode = String(selection.mode).toLowerCase();
    let draftData = null;
    let activeVersionId = null;
    let sourceVersionId = null;

    if (mode === "resume") {
      const versionId = selection.versionId ? String(selection.versionId) : null;
      if (!versionId) return res.status(400).json({ error: "versionId required to resume" });
      const version = await fetchVersionById(versionId, { includeData: true });
      if (!version) return res.status(404).json({ error: "Draft version not found" });
      if (!ACTIVE_VERSION_KINDS.has(version.kind)) {
        return res.status(400).json({ error: "Version cannot be resumed" });
      }
      draftData = version.data || {};
      activeVersionId = version.id;
      sourceVersionId = version.id;
    } else if (mode === "snapshot") {
      const versionId = selection.versionId ? String(selection.versionId) : null;
      if (!versionId) return res.status(400).json({ error: "versionId required to load snapshot" });
      const version = await fetchVersionById(versionId, { includeData: true });
      if (!version) return res.status(404).json({ error: "Snapshot not found" });
      draftData = version.data || {};
      const newVersion = await insertVersion({
        stage: "draft",
        kind: VERSION_KIND_DRAFT,
        label: selection.label || version.label || "Draft from snapshot",
        note: selection.note || version.note || null,
        authorEmail: email,
        data: draftData,
      });
      activeVersionId = newVersion.id;
      sourceVersionId = version.id;
    } else if (mode === "new") {
      const source = selection.source ? String(selection.source) : "live";
      if (source === "blank") {
        draftData = {};
      } else {
        const liveSel = await supabase
          .from("settings_public")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (liveSel.error && liveSel.error.code !== "PGRST116") throw liveSel.error;
        draftData = filterAllowed(liveSel.data || {});
      }
      const newVersion = await insertVersion({
        stage: "draft",
        kind: VERSION_KIND_DRAFT,
        label: selection.label || "New draft", // optional user-supplied label
        note: selection.note || null,
        authorEmail: email,
        data: draftData,
      });
      activeVersionId = newVersion.id;
      sourceVersionId = selection.sourceVersionId ? String(selection.sourceVersionId) : null;
    } else {
      return res.status(400).json({ error: "Unsupported acquisition mode" });
    }

    const draft = await writeDraftSettings(draftData || {});

    const update = await supabase
      .from("settings_lock")
      .update({
        holder_email: email,
        acquired_at: now.toISOString(),
        expires_at: expiresAtIso,
        active_version_id: activeVersionId,
        source_version_id: sourceVersionId,
        auto_saved_version_id: null,
      })
      .eq("id", 1)
      .select("*")
      .single();
    if (update.error) throw update.error;

    const lock = mapLockRow(update.data);
    const [activeVersion, sourceVersion] = await Promise.all([
      lock.active_version_id ? fetchVersionById(lock.active_version_id) : Promise.resolve(null),
      lock.source_version_id ? fetchVersionById(lock.source_version_id) : Promise.resolve(null),
    ]);
    if (activeVersion) lock.active_version = activeVersion;
    if (sourceVersion) lock.source_version = sourceVersion;

    try {
      await logAdminAction(email, "settings.lock.acquire", {
        expires_at: lock.expires_at,
        active_version_id: lock.active_version_id,
        source_version_id: lock.source_version_id,
        mode,
      });
    } catch (err) {
      console.warn("Failed to log lock acquire", err?.message || err);
    }

    res.json({
      locked: true,
      lock,
      draft,
    });
  } catch (err) {
    console.error("POST /api/settings/lock/acquire error:", err);
    res.status(500).json({ error: "Failed to acquire lock" });
  }
});

router.post("/lock/release", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;

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

    const draftId = await ensureSingleton("draft");
    const draftSel = await supabase.from("settings_draft").select("*").eq("id", draftId).single();
    if (draftSel.error) throw draftSel.error;
    const draftData = filterAllowed(draftSel.data || {});

    let autoSavedVersion = null;
    const doAutoSave = Boolean(req.body?.autoSave);

    if (sel.data.active_version_id) {
      try {
        await updateVersionData(sel.data.active_version_id, draftData);
      } catch (err) {
        console.warn("Failed to sync active draft version", err?.message || err);
      }
    }

    if (doAutoSave) {
      const label = req.body?.autoSaveLabel || `Auto-save ${new Date().toLocaleString()}`;
      const note =
        typeof req.body?.autoSaveNote === "string"
          ? req.body.autoSaveNote
          : `Automatically saved before releasing by ${email}`;
      try {
        autoSavedVersion = await insertVersion({
          stage: "draft",
          kind: VERSION_KIND_AUTOSAVE,
          label,
          note,
          authorEmail: email,
          data: draftData,
        });
      } catch (err) {
        console.warn("Failed to create auto-save snapshot", err?.message || err);
      }
    }

    const update = await supabase
      .from("settings_lock")
      .update({
        holder_email: null,
        acquired_at: null,
        expires_at: null,
        active_version_id: null,
        source_version_id: null,
        auto_saved_version_id: autoSavedVersion?.id || null,
      })
      .eq("id", 1)
      .select("*")
      .single();
    if (update.error) throw update.error;

    try {
      await logAdminAction(email, "settings.lock.release", {
        auto_saved_version_id: autoSavedVersion?.id || null,
      });
    } catch (err) {
      console.warn("Failed to log lock release", err?.message || err);
    }

    res.json({ lock: null, locked: false, autoSavedVersion });
  } catch (err) {
    console.error("POST /api/settings/lock/release error:", err);
    res.status(500).json({ error: "Failed to release lock" });
  }
});

router.get("/versions", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const limit = clampLimit(req.query.limit, 20);
    const stageFilter = req.query.stage === "live" ? "live" : req.query.stage === "draft" ? "draft" : undefined;
    const kindFilter = req.query.kind ? String(req.query.kind) : undefined;

    const versions = await listVersionsInternal({
      limit,
      stage: stageFilter,
      kind: kindFilter,
    });

    res.json({ versions });
  } catch (err) {
    console.error("GET /api/settings/versions error:", err);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

router.post("/versions", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const stage = req.body?.stage === "live" ? "live" : "draft";
    const label = typeof req.body?.label === "string" && req.body.label.trim().length > 0 ? req.body.label.trim() : null;
    const note = typeof req.body?.note === "string" && req.body.note.trim().length > 0 ? req.body.note.trim() : null;
    const kindRaw = req.body?.kind ? String(req.body.kind) : stage === "live" ? VERSION_KIND_PUBLISHED : VERSION_KIND_DRAFT;
    const kind = normalizeKind(kindRaw);
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

    const version = await insertVersion({
      stage,
      kind,
      label,
      note,
      authorEmail: email,
      data: snapshot,
      status: VERSION_STATUS_ACTIVE,
      publishedAt: stage === "live" ? new Date().toISOString() : null,
    });

    if (req.body?.setDefault) {
      await markDefaultSnapshot(version.id, email);
    }

    try {
      await logAdminAction(email, "settings.version.create", {
        stage,
        label,
        kind,
        snapshotKeys: Object.keys(stripMetaFields(snapshot)),
      });
    } catch (err) {
      console.warn("Failed to log version create", err?.message || err);
    }

    res.json({ success: true, version });
  } catch (err) {
    console.error("POST /api/settings/versions error:", err);
    res.status(500).json({ error: "Failed to create version" });
  }
});

router.patch("/versions/:id", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const versionId = req.params.id;
    if (!versionId) return res.status(400).json({ error: "Missing version id" });

    const email = (req.user?.email || "unknown").toLowerCase();
    const label = req.body?.label;
    const note = req.body?.note;
    const kind = req.body?.kind;
    const status = req.body?.status;
    const isDefault = req.body?.isDefault;

    const version = await updateVersionMetadata(versionId, {
      label: typeof label === "string" ? label.trim() : undefined,
      note: typeof note === "string" ? note.trim() : undefined,
      kind: kind ? String(kind) : undefined,
      status: status ? String(status) : undefined,
      isDefault: typeof isDefault === "boolean" ? isDefault : undefined,
      actorEmail: email,
    });

    try {
      await logAdminAction(email, "settings.version.update", {
        versionId,
        label: version.label,
        note: version.note,
        kind: version.kind,
        status: version.status,
        is_default: version.is_default,
      });
    } catch (err) {
      console.warn("Failed to log version update", err?.message || err);
    }

    res.json({ success: true, version });
  } catch (err) {
    console.error("PATCH /api/settings/versions/:id error:", err);
    if (err?.message === "Missing version id") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to update version" });
  }
});

router.post("/versions/:id/restore", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
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

router.delete("/versions/:id", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const versionId = req.params.id;
    const email = (req.user?.email || "unknown").toLowerCase();

    const removed = await supabase
      .from("settings_versions")
      .delete()
      .eq("id", versionId)
      .select("id, stage, label")
      .single();

    if (removed.error) {
      if (removed.error.code === "PGRST116") return res.status(404).json({ error: "Version not found" });
      throw removed.error;
    }

    try {
      await logAdminAction(email, "settings.version.delete", {
        versionId,
        stage: removed.data.stage,
        label: removed.data.label,
      });
    } catch {}

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/settings/versions/:id error:", err);
    res.status(500).json({ error: "Failed to delete version" });
  }
});

router.get("/deployments", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    await processDeploymentSchedule();
    const includePast = String(req.query.includePast).toLowerCase() === "true";
    const deployments = await listDeployments({ includePast });
    const ids = new Set();
    for (const deployment of deployments) {
      if (deployment.snapshot_id) ids.add(deployment.snapshot_id);
      if (deployment.fallback_snapshot_id) ids.add(deployment.fallback_snapshot_id);
    }

    const versions = await Promise.all(Array.from(ids).map((id) => fetchVersionById(id).catch(() => null)));
    const versionMap = new Map();
    versions.forEach((version) => {
      if (version) versionMap.set(version.id, version);
    });

    const enriched = deployments.map((deployment) => ({
      ...deployment,
      snapshot: deployment.snapshot_id ? versionMap.get(deployment.snapshot_id) || null : null,
      fallback_snapshot: deployment.fallback_snapshot_id
        ? versionMap.get(deployment.fallback_snapshot_id) || null
        : null,
    }));

    res.json({ deployments: enriched });
  } catch (err) {
    console.error("GET /api/settings/deployments error:", err);
    res.status(500).json({ error: "Failed to load deployments" });
  }
});

router.post("/deployments", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const email = (req.user?.email || "unknown").toLowerCase();
    const snapshotId = req.body?.snapshotId ? String(req.body.snapshotId) : null;
    if (!snapshotId) return res.status(400).json({ error: "snapshotId is required" });

    const startAtRaw = req.body?.startAt ? new Date(req.body.startAt) : null;
    if (!startAtRaw || Number.isNaN(startAtRaw.getTime())) {
      return res.status(400).json({ error: "startAt is required" });
    }
    const endAtRaw = req.body?.endAt ? new Date(req.body.endAt) : null;
    if (endAtRaw && Number.isNaN(endAtRaw.getTime())) {
      return res.status(400).json({ error: "Invalid endAt" });
    }
    if (endAtRaw && endAtRaw <= startAtRaw) {
      return res.status(400).json({ error: "endAt must be after startAt" });
    }

    const fallbackSnapshotId = req.body?.fallbackSnapshotId ? String(req.body.fallbackSnapshotId) : null;

    const existing = await listDeployments();
    for (const deployment of existing) {
      const existingStart = deployment.start_at ? new Date(deployment.start_at) : null;
      const existingEnd = deployment.end_at ? new Date(deployment.end_at) : null;
      if (windowsOverlap(startAtRaw, endAtRaw, existingStart, existingEnd)) {
        return res.status(409).json({
          error: "Deployment window overlaps with an existing schedule. Adjust the start or end time.",
          conflictingDeploymentId: deployment.id,
        });
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const startIso = startAtRaw.toISOString();
    const endIso = endAtRaw ? endAtRaw.toISOString() : null;
    const immediate = startAtRaw <= now;
    const status = immediate ? DEPLOYMENT_STATUS_RUNNING : DEPLOYMENT_STATUS_SCHEDULED;

    const insert = await supabase
      .from("settings_deployments")
      .insert([
        {
          snapshot_id: snapshotId,
          fallback_snapshot_id: fallbackSnapshotId,
          start_at: startIso,
          end_at: endIso,
          status,
          created_by: email,
          updated_by: email,
          created_at: nowIso,
          updated_at: nowIso,
          activated_at: immediate ? nowIso : null,
        },
      ])
      .select("*")
      .single();
    if (insert.error) throw insert.error;

    if (immediate) {
      await applySnapshotToStage(snapshotId, "live", email, "schedule_immediate_start");
    }

    await processDeploymentSchedule();

    try {
      await logAdminAction(email, "settings.schedule.create", {
        deploymentId: insert.data.id,
        snapshotId,
        start_at: startIso,
        end_at: endIso,
      });
    } catch (err) {
      console.warn("Failed to log deployment creation", err?.message || err);
    }

    res.json({ success: true, deployment: insert.data });
  } catch (err) {
    console.error("POST /api/settings/deployments error:", err);
    res.status(500).json({ error: "Failed to create deployment" });
  }
});

router.post("/deployments/:id/cancel", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const email = (req.user?.email || "unknown").toLowerCase();
    const deploymentId = req.params.id;
    if (!deploymentId) return res.status(400).json({ error: "Missing deployment id" });

    const deployment = await loadDeployment(deploymentId);
    if (!deployment) return res.status(404).json({ error: "Deployment not found" });
    if (deployment.status === DEPLOYMENT_STATUS_CANCELLED || deployment.status === DEPLOYMENT_STATUS_COMPLETED) {
      return res.status(400).json({ error: "Deployment already closed" });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const applyFallback = Boolean(req.body?.applyFallback);

    if (applyFallback) {
      let fallback = deployment.fallback_snapshot_id;
      if (!fallback) {
        const defaultSnapshot = await getDefaultSnapshot();
        fallback = defaultSnapshot?.id || null;
      }
      if (fallback) {
        await applySnapshotToStage(fallback, "live", email, "schedule_cancel_fallback");
      }
    }

    const update = await supabase
      .from("settings_deployments")
      .update({
        status: DEPLOYMENT_STATUS_CANCELLED,
        updated_at: nowIso,
        cancelled_at: nowIso,
        cancelled_by: email,
        updated_by: email,
      })
      .eq("id", deploymentId)
      .select("*")
      .single();
    if (update.error) throw update.error;

    try {
      await logAdminAction(email, "settings.schedule.cancel", {
        deploymentId,
        applyFallback,
      });
    } catch (err) {
      console.warn("Failed to log deployment cancel", err?.message || err);
    }

    res.json({ success: true, deployment: update.data });
  } catch (err) {
    console.error("POST /api/settings/deployments/:id/cancel error:", err);
    res.status(500).json({ error: "Failed to cancel deployment" });
  }
});

router.post("/deployments/:id/override", requireAdmin, async (req, res) => {
  try {
    const supabase = await ensureSupabaseWritable(res);
    if (!supabase) return;
    const email = (req.user?.email || "unknown").toLowerCase();
    const deploymentId = req.params.id;
    if (!deploymentId) return res.status(400).json({ error: "Missing deployment id" });

    const deployment = await loadDeployment(deploymentId);
    if (!deployment) return res.status(404).json({ error: "Deployment not found" });
    if (deployment.status === DEPLOYMENT_STATUS_CANCELLED || deployment.status === DEPLOYMENT_STATUS_COMPLETED) {
      return res.status(400).json({ error: "Deployment already closed" });
    }

    const nowIso = new Date().toISOString();
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "Manual override";

    const update = await supabase
      .from("settings_deployments")
      .update({
        status: DEPLOYMENT_STATUS_CANCELLED,
        updated_at: nowIso,
        cancelled_at: nowIso,
        cancelled_by: email,
        updated_by: email,
        override_reason: reason,
      })
      .eq("id", deploymentId)
      .select("*")
      .single();
    if (update.error) throw update.error;

    try {
      await logAdminAction(email, "settings.schedule.override", {
        deploymentId,
        reason,
      });
    } catch (err) {
      console.warn("Failed to log deployment override", err?.message || err);
    }

    res.json({ success: true, deployment: update.data });
  } catch (err) {
    console.error("POST /api/settings/deployments/:id/override error:", err);
    res.status(500).json({ error: "Failed to override deployment" });
  }
});

// GET /api/settings/preview – read draft row for /?stage=draft
router.get("/preview", async (_req, res) => {
  try {
    const { supabase } = await getSupabaseContext();
    if (!supabase) {
      const localSettings = await loadLocalSettings();
      return res.json(stripMetaFields(localSettings));
    }
    await processDeploymentSchedule();
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
