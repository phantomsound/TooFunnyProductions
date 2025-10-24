import { Router } from "express";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DEFAULT_SETTINGS_PATH = join(DATA_DIR, "settings.json");
const LOCAL_SETTINGS_PATH = join(DATA_DIR, "settings.local.json");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  CONTACT_TO: CONTACT_TO_FALLBACK,
} = process.env;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

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

  // If SMTP envs are not set, just log and return 200 for dev convenience
  const {
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.log("📨 (dev) contact message:", { name, from, message, to: toAddress });
    return res.json({ ok: true, dev: true });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"Too Funny Website" <${SMTP_USER}>`,
      to: toAddress,
      subject: `Contact form: ${name}`,
      replyTo: from,
      text: message,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("contact send failed:", e);
    res.status(500).json({ error: "Failed to send" });
  }
});

export default router;
