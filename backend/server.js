// backend/server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import session from "express-session";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initAuth } from "./auth.js";
import settingsRoutes from "./routes/settings.js";
import adminRoutes from "./routes/admin.js";
import contactRoutes from "./routes/contact.js"; // <-- import after core
import storageRoutes from "./routes/storage.js";
import messagingRoutes, { registerMessagingHub } from "./routes/messaging.js";
import { createMessagingHub } from "./lib/messagingHub.js";
import { bootstrapMessagingStore } from "./lib/messagingStore.js";

const app = express();
const isProd = process.env.NODE_ENV === "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowAllOrigins = rawOrigins.includes("*");

// CORS (allow frontend and cookies)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAllOrigins || rawOrigins.includes(origin)) {
        return callback(null, origin);
      }
      console.warn(`Blocked CORS origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  })
);

// Body parser
app.use(express.json());

// Sessions must be mounted before initAuth()
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
});
app.use(sessionMiddleware);

// Auth (adds /api/auth/*)
initAuth(app);

// API routes
app.use("/api/settings", settingsRoutes);
app.use("/api/admin/messaging", messagingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/storage", storageRoutes);

// Health & root
app.get("/api/health", (_req, res) => res.json({ ok: true }));
const distCandidates = [
  process.env.FRONTEND_DIST ? path.resolve(__dirname, process.env.FRONTEND_DIST) : null,
  path.resolve(__dirname, "../frontend/dist"),
  path.resolve(__dirname, "../frontend-dist"),
].filter((candidate) => !!candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());

let servedFrontend = false;
if (distCandidates.length > 0) {
  const distDir = distCandidates[0];
  const indexHtml = path.join(distDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    servedFrontend = true;
    console.log(`📦 Serving frontend from ${distDir}`);
    app.use(express.static(distDir, { index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
  }
}

if (!servedFrontend) {
  app.get("/", (_req, res) => {
    res
      .type("text/plain")
      .send("Too Funny Productions API\n\nTry /api/health or /api/settings");
  });
}

const port = process.env.PORT || 5000;
const server = app.listen(port, () => console.log(`API listening on :${port}`));

bootstrapMessagingStore().catch((err) => {
  console.warn("Failed to initialize messaging store:", err?.message || err);
});

const messagingHub = createMessagingHub({ server, sessionMiddleware });
registerMessagingHub(messagingHub);
