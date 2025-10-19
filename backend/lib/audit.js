// backend/lib/audit.js
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config(); // ensure .env is loaded even if server.js forgot

let _sb = null;
function getServiceClient() {
  if (_sb) return _sb;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Audit logger: missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return null;
  }
  _sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _sb;
}

/**
 * Log an admin action. Fails quietly if env is missing.
 */
export async function logAdminAction(actorEmail, action, payload = null) {
  try {
    const sb = getServiceClient();
    if (!sb) return; // don't throw on servers without secrets
    await sb.from("admin_actions").insert([{ actor_email: actorEmail, action, payload }]);
  } catch (e) {
    console.error("Audit log insert failed:", e?.message || e);
  }
}
