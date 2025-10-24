// backend/routes/admin.js
import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { getAuditClient, listAdminActions, logAdminAction } from "../lib/audit.js";
import {
  getAllowlist,
  getEditableAllowlist,
  getEnvAllowlist,
  normalizeAllowlistInput,
  setEditableAllowlist,
} from "../lib/allowlist.js";

const router = Router();

// The publish logic lives in /api/settings/publish.
// Keep this route around for legacy clients but point them to the supported endpoint.
router.post("/publish", requireAdmin, (_req, res) => {
  res.status(410).json({
    error: "Deprecated endpoint. Use POST /api/settings/publish instead.",
  });
});

// GET /api/admin/audit
router.get("/audit", requireAdmin, async (req, res) => {
  try {
    if (!getAuditClient()) {
      return res.status(500).json({ error: "Supabase not configured." });
    }

    const { limit, actor, action, q, direction } = req.query;

    const items = await listAdminActions({
      limit: limit ? Number(limit) : undefined,
      actor: actor ? String(actor) : undefined,
      action: action ? String(action) : undefined,
      search: q ? String(q) : undefined,
      direction: direction ? String(direction) : undefined,
    });

    const actors = Array.from(new Set(items.map((row) => row.actor_email).filter(Boolean))).sort();
    const actions = Array.from(new Set(items.map((row) => row.action).filter(Boolean))).sort();

    res.json({ items, actors, actions });
  } catch (err) {
    console.error("GET /api/admin/audit error:", err);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

// GET /api/admin/allowlist
router.get("/allowlist", requireAdmin, (_req, res) => {
  res.json({
    combined: getAllowlist(),
    editable: getEditableAllowlist(),
    env: getEnvAllowlist(),
  });
});

// PUT /api/admin/allowlist
router.put("/allowlist", requireAdmin, async (req, res) => {
  try {
    const normalized = normalizeAllowlistInput(req.body?.emails ?? []);
    const editable = await setEditableAllowlist(normalized);
    const combined = getAllowlist();
    const env = getEnvAllowlist();

    try {
      await logAdminAction(req.user?.email || "unknown", "allowlist_update", {
        count: editable.length,
      });
    } catch (err) {
      console.warn("Failed to log allowlist update", err?.message || err);
    }

    res.json({ combined, editable, env });
  } catch (err) {
    console.error("PUT /api/admin/allowlist error:", err);
    res.status(500).json({ error: "Failed to update allowlist" });
  }
});

export default router;
