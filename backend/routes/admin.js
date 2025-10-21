// backend/routes/admin.js
import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { getAuditClient, listAdminActions } from "../lib/audit.js";

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

export default router;
