import { Router } from "express";
import nodemailer from "nodemailer";

const router = Router();

/**
 * POST /api/contact
 * Body: { name, from, message }
 * Sends an email via SMTP (or logs in dev if not configured).
 */
router.post("/", async (req, res) => {
  const { name, from, message } = req.body || {};
  if (!name || !from || !message) return res.status(400).json({ error: "Missing fields" });

  // If SMTP envs are not set, just log and return 200 for dev convenience
  const {
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !CONTACT_TO) {
    console.log("📨 (dev) contact message:", { name, from, message });
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
      to: CONTACT_TO,
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
