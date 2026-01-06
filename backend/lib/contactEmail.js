// backend/lib/contactEmail.js
import nodemailer from "nodemailer";

export function getSmtpConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  };
}

export async function sendContactEmail({ to, from, name, message }) {
  const smtp = getSmtpConfig();
  if (!smtp) {
    const error = new Error("SMTP not configured.");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  const transporter = nodemailer.createTransport(smtp);
  await transporter.sendMail({
    from: `"Too Funny Website" <${smtp.auth.user}>`,
    to,
    subject: `Contact form: ${name}`,
    replyTo: from,
    text: message,
  });
}
