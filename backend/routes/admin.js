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
import {
  exportContactResponses,
  listContactResponses,
  updateContactResponse,
} from "../lib/contactResponses.js";

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

    const { limit, actor, action, q, direction, includeMessaging } = req.query;

    let items = await listAdminActions({
      limit: limit ? Number(limit) : undefined,
      actor: actor ? String(actor) : undefined,
      action: action ? String(action) : undefined,
      search: q ? String(q) : undefined,
      direction: direction ? String(direction) : undefined,
    });

    if (!action && String(includeMessaging).toLowerCase() !== "true") {
      items = items.filter((row) => row.action !== "messaging");
    }

    const actors = Array.from(new Set(items.map((row) => row.actor_email).filter(Boolean))).sort();
    const actions = Array.from(new Set(items.map((row) => row.action).filter(Boolean))).sort();

    res.json({ items, actors, actions });
  } catch (err) {
    console.error("GET /api/admin/audit error:", err);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

router.get("/contact-responses", requireAdmin, async (req, res) => {
  try {
    const { q, responded, limit, offset, sort, format } = req.query;
    const options = {
      search: q ? String(q) : undefined,
      responded: responded ?? undefined,
      limit: limit ?? undefined,
      offset: offset ?? undefined,
      sort: sort ?? undefined,
    };

    if (String(format).toLowerCase() === "csv") {
      const csv = await exportContactResponses(options);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=contact-responses.csv");
      return res.send(csv);
    }

    const payload = await listContactResponses(options);
    res.json(payload);
  } catch (err) {
    console.error("GET /api/admin/contact-responses error:", err);
    res.status(500).json({ error: "Failed to load contact responses" });
  }
});

router.patch("/contact-responses/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { responded, respondedAt, notes } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing contact response id" });

    const patch = {};
    if (responded !== undefined) {
      patch.responded = responded;
      if (responded) {
        patch.responded_by = req.user?.email || "unknown";
        if (respondedAt) patch.responded_at = respondedAt;
      }
    }
    if (notes !== undefined) patch.notes = notes;

    const updated = await updateContactResponse(id, patch);

    try {
      await logAdminAction(req.user?.email || "unknown", "contact_response_update", {
        id,
        responded: updated.responded,
        hasNotes: !!updated.notes,
      });
    } catch (err) {
      console.warn("Failed to log contact response update", err?.message || err);
    }

    res.json({ item: updated });
  } catch (err) {
    console.error("PATCH /api/admin/contact-responses/:id error:", err);
    if (err?.message === "Contact response not found") {
      return res.status(404).json({ error: "Not found" });
    }
    res.status(500).json({ error: "Failed to update contact response" });
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
