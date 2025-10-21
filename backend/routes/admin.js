// backend/routes/admin.js
import { Router } from "express";
import { requireAdmin } from "../auth.js";

const router = Router();

// The publish logic lives in /api/settings/publish.
// Keep this route around for legacy clients but point them to the supported endpoint.
router.post("/publish", requireAdmin, (_req, res) => {
  res.status(410).json({
    error: "Deprecated endpoint. Use POST /api/settings/publish instead.",
  });
});

export default router;
