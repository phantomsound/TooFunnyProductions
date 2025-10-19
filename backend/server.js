// backend/server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import session from "express-session";

import { initAuth } from "./auth.js";
import settingsRoutes from "./routes/settings.js";
import adminRoutes from "./routes/admin.js";
import contactRoutes from "./routes/contact.js"; // <-- import after core

const app = express();
const isProd = process.env.NODE_ENV === "production";

// CORS (allow frontend and cookies)
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

// Body parser
app.use(express.json());

// Sessions must be mounted before initAuth()
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// Auth (adds /api/auth/*)
initAuth(app);

// API routes
app.use("/api/settings", settingsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/contact", contactRoutes);

// Health & root
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send("Too Funny Productions API\n\nTry /api/health or /api/settings");
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API listening on :${port}`));
