import { Router } from "express";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { noteDeliveryStatus, recordContactResponse } from "../lib/contactResponses.js";
import { getSupabaseServiceClient } from "../lib/supabaseClient.js";
import { sendContactEmail, getSmtpConfig } from "../lib/contactEmail.js";

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DEFAULT_SETTINGS_PATH = join(DATA_DIR, "settings.json");
const LOCAL_SETTINGS_PATH = join(DATA_DIR, "settings.local.json");

const { CONTACT_TO: CONTACT_TO_FALLBACK } = process.env;

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

async function fetchContactEmailFromSupabase() {
  const supabase = await getSupabaseServiceClient();
  if (!supabase) return null;
  try {
    const sel = await supabase
      .from("settings_public")
      .select("contactemail")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (sel.error) throw sel.error;

    const email = sel.data?.contactemail;
    if (typeof email === "string" && email.trim()) return email.trim();
  } catch (err) {
    console.error("contact: failed to load contactemail from Supabase:", err);
  }
  return null;
}

let cachedContactEmail = null;
let cachedContactEmailFetchedAt = 0;
const CONTACT_EMAIL_CACHE_MS = 1000 * 60; // 1 minute

async function resolveContactRecipient() {
  const now = Date.now();
  if (cachedContactEmail && now - cachedContactEmailFetchedAt < CONTACT_EMAIL_CACHE_MS) {
    return cachedContactEmail;
  }

  const fromSupabase = await fetchContactEmailFromSupabase();
  if (fromSupabase) {
    cachedContactEmail = fromSupabase;
    cachedContactEmailFetchedAt = now;
    return cachedContactEmail;
  }

  try {
    const localSettings = await loadLocalSettings();
    const fromLocal = localSettings?.contactemail;
    if (typeof fromLocal === "string" && fromLocal.trim()) {
      cachedContactEmail = fromLocal.trim();
      cachedContactEmailFetchedAt = now;
      return cachedContactEmail;
    }
  } catch (err) {
    console.error("contact: failed to read local settings:", err);
  }

  const fallback = CONTACT_TO_FALLBACK || "info@toofunnyproductions.com";
  cachedContactEmail = fallback;
  cachedContactEmailFetchedAt = now;
  return fallback;
}

/**
 * POST /api/contact
 * Body: { name, from, message }
 * Sends an email via SMTP (or logs in dev if not configured).
 */
router.post("/", async (req, res) => {
  const { name, from, message } = req.body || {};
  if (!name || !from || !message) return res.status(400).json({ error: "Missing fields" });

  const toAddress = await resolveContactRecipient();

  let savedRecord = null;
  try {
    savedRecord = await recordContactResponse({
      name,
      email: from,
      message,
      meta: {
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
        to: toAddress,
      },
    });
  } catch (err) {
    console.error("contact: failed to persist contact response:", err);
  }

  // If SMTP envs are not set, just log and return 200 for dev convenience
  if (!getSmtpConfig()) {
    console.log("📨 (dev) contact message:", { name, from, message, to: toAddress });
    if (savedRecord) {
      try {
        await noteDeliveryStatus(savedRecord.id, "skipped");
      } catch (err) {
        console.warn("contact: failed to update delivery status for dev message:", err?.message || err);
      }
    }
    return res.json({ ok: true, dev: true });
  }

  try {
    await sendContactEmail({ to: toAddress, from, name, message });

    if (savedRecord) {
      try {
        await noteDeliveryStatus(savedRecord.id, "sent");
      } catch (err) {
        console.warn("contact: failed to update delivery status after send:", err?.message || err);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("contact send failed:", e);
    if (savedRecord) {
      try {
        await noteDeliveryStatus(savedRecord.id, "failed", e?.message || String(e));
      } catch (err) {
        console.warn("contact: failed to persist failed delivery status:", err?.message || err);
      }
    }
    res.status(500).json({ error: "Failed to send" });
  }
});

export default router;
