// backend/lib/messagingHub.js
// -----------------------------------------------------------------------------
// WebSocket hub for admin messaging. Handles authentication via session,
// presence updates, and broadcast helpers for message + unread events.
// -----------------------------------------------------------------------------
import { WebSocketServer } from "ws";

import { getAllowlist } from "../lib/allowlist.js";
import {
  getPresence,
  setPresence,
  getUnreadCountsFor,
} from "./messagingStore.js";

const HEARTBEAT_INTERVAL = 1000 * 30;

export function createMessagingHub({ server, sessionMiddleware, path = "/api/admin/messaging/ws" }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map(); // ws -> email

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith(path)) {
      return;
    }

    sessionMiddleware(request, {}, async () => {
      try {
        const email = request.session?.passport?.user?.email?.toLowerCase?.();
        if (!email || !getAllowlist().includes(email)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request, email);
        });
      } catch (err) {
        console.error("WebSocket upgrade failed", err?.message || err);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      }
    });
  });

  async function broadcast(event) {
    const payload = JSON.stringify(event);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  }

  async function pushPresence(email, status) {
    const presence = await setPresence(email, status);
    await broadcast({ type: "presence", payload: { email, status: presence[email]?.status ?? status, updated_at: presence[email]?.updated_at } });
  }

  function scheduleHeartbeat(ws) {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  }

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL).unref?.();

  wss.on("connection", async (ws, request, email) => {
    const normalizedEmail = email?.toLowerCase?.();
    clients.set(ws, normalizedEmail);
    scheduleHeartbeat(ws);

    ws.send(
      JSON.stringify({
        type: "init",
        payload: {
          me: normalizedEmail,
          presence: await getPresence(),
          unread: await getUnreadCountsFor(normalizedEmail),
        },
      })
    );

    await pushPresence(normalizedEmail, "online");

    ws.on("close", async () => {
      clients.delete(ws);
      const stillOnline = Array.from(clients.values()).includes(normalizedEmail);
      if (!stillOnline) {
        await pushPresence(normalizedEmail, "offline");
      }
    });

    ws.on("message", async (data) => {
      try {
        const payload = JSON.parse(String(data));
        if (payload?.type === "presence" && payload?.status === "online") {
          await pushPresence(normalizedEmail, "online");
        }
      } catch (err) {
        console.warn("Ignoring malformed messaging socket payload", err?.message || err);
      }
    });
  });

  wss.on("close", () => clearInterval(interval));

  return {
    server: wss,
    broadcast,
    notifyMessage: async ({ conversation, message, revivedFrom }) => {
      await broadcast({
        type: "message",
        payload: {
          conversation: {
            id: conversation.id,
            subject: conversation.subject,
            last_message_at: conversation.last_message_at,
            archived_at: conversation.archived_at,
            preview: message,
          },
          message,
          revivedFrom,
        },
      });

      for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue;
        const targetEmail = clients.get(ws);
        if (!targetEmail || targetEmail === message.sender_email) continue;
        const unread = await getUnreadCountsFor(targetEmail);
        ws.send(JSON.stringify({ type: "unread", payload: { email: targetEmail, unread } }));
      }
    },
    notifyRead: async ({ email }) => {
      for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue;
        const targetEmail = clients.get(ws);
        if (!targetEmail || targetEmail !== email) continue;
        const unread = await getUnreadCountsFor(targetEmail);
        ws.send(JSON.stringify({ type: "unread", payload: { email: targetEmail, unread } }));
      }
    },
  };
}

