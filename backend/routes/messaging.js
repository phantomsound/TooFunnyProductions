// backend/routes/messaging.js
// -----------------------------------------------------------------------------
// Admin messaging REST API surface area. Coordinates with the JSON-backed
// messaging store and websocket hub for live updates.
// -----------------------------------------------------------------------------
import { Router } from "express";

import { requireAdmin } from "../auth.js";
import { logAdminAction } from "../lib/audit.js";
import {
  appendMessage,
  createConversation,
  getConversation,
  getPresence,
  listConversations,
  markConversationRead,
  searchConversations,
  getUnreadCountsFor,
} from "../lib/messagingStore.js";
import { loadAdminProfiles } from "../lib/settingsLoader.js";

const router = Router();

let hub = null;
export const registerMessagingHub = (instance) => {
  hub = instance;
};

router.get("/conversations", requireAdmin, async (req, res) => {
  try {
    const { q, archived } = req.query;
    const conversations = await listConversations({
      search: q ? String(q) : undefined,
      archived: archived === undefined ? undefined : String(archived).toLowerCase() === "true",
    });
    res.json({ conversations });
  } catch (err) {
    console.error("GET /api/admin/messaging/conversations error:", err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

router.get("/conversations/search", requireAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    const conversations = await searchConversations(q ? String(q) : "");
    res.json({ conversations });
  } catch (err) {
    console.error("GET /api/admin/messaging/conversations/search error:", err);
    res.status(500).json({ error: "Failed to search conversations" });
  }
});

router.post("/conversations", requireAdmin, async (req, res) => {
  try {
    const { subject, participants } = req.body || {};
    const creator = {
      email: req.user?.email || "unknown",
      name: req.user?.name || "Admin",
      avatar_url: req.user?.picture || "",
    };
    const conversation = await createConversation({ subject, participants, createdBy: creator });

    try {
      await logAdminAction(creator.email, "messaging", {
        event: "conversation.created",
        conversationId: conversation.id,
        subject: conversation.subject,
      });
    } catch {}

    res.status(201).json({ conversation });
  } catch (err) {
    console.error("POST /api/admin/messaging/conversations error:", err);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/conversations/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await getConversation(id);
    if (!conversation) return res.status(404).json({ error: "Not found" });
    res.json({ conversation });
  } catch (err) {
    console.error("GET /api/admin/messaging/conversations/:id error:", err);
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

router.post("/conversations/:id/messages", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { body, meta } = req.body || {};
    if (!body || typeof body !== "string" || body.trim().length === 0) {
      return res.status(400).json({ error: "Message body is required" });
    }

    const sender = {
      email: req.user?.email || "unknown",
      name: req.user?.name || "Admin",
      avatar_url: req.user?.picture || "",
    };

    const result = await appendMessage(id, { sender, body, meta });

    try {
      await logAdminAction(sender.email, "messaging", {
        event: "message.sent",
        conversationId: result.conversation.id,
        messageId: result.message.id,
      });
    } catch {}

    if (hub) {
      await hub.notifyMessage(result);
    }

    res.status(201).json(result);
  } catch (err) {
    console.error("POST /api/admin/messaging/conversations/:id/messages error:", err);
    if (err?.message === "Conversation not found") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.post("/conversations/:id/read", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reader = req.user?.email || "unknown";
    const conversation = await markConversationRead(id, reader);
    if (hub) {
      await hub.notifyRead({ email: reader });
    }
    res.json({ conversation });
  } catch (err) {
    console.error("POST /api/admin/messaging/conversations/:id/read error:", err);
    if (err?.message === "Conversation not found") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.status(500).json({ error: "Failed to mark conversation read" });
  }
});

router.get("/presence", requireAdmin, async (_req, res) => {
  try {
    const presence = await getPresence();
    res.json({ presence });
  } catch (err) {
    console.error("GET /api/admin/messaging/presence error:", err);
    res.status(500).json({ error: "Failed to load presence" });
  }
});

router.get("/unread", requireAdmin, async (req, res) => {
  try {
    const email = req.user?.email || "unknown";
    const unread = await getUnreadCountsFor(email);
    res.json({ unread });
  } catch (err) {
    console.error("GET /api/admin/messaging/unread error:", err);
    res.status(500).json({ error: "Failed to load unread counts" });
  }
});

router.get("/roster", requireAdmin, async (_req, res) => {
  try {
    const roster = await loadAdminProfiles("draft");
    res.json({ roster });
  } catch (err) {
    console.error("GET /api/admin/messaging/roster error:", err);
    res.status(500).json({ error: "Failed to load roster" });
  }
});

export default router;

