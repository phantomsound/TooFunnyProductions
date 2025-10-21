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
export async function logAdminAction(actorEmail, action, meta = null) {
  try {
    const sb = getServiceClient();
    if (!sb) return; // don't throw on servers without secrets
    await sb.from("admin_actions").insert([
      {
        actor_email: actorEmail,
        action,
        meta,
        occurred_at: new Date().toISOString(),
      },
    ]);
  } catch (e) {
    console.error("Audit log insert failed:", e?.message || e);
  }
}

/**
 * Fetch audit log rows for the admin dashboard.
 */
export async function listAdminActions({ limit = 100, actor, action, search, direction } = {}) {
  const sb = getServiceClient();
  if (!sb) {
    throw new Error("Supabase service client not configured");
  }

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const ascending = String(direction).toLowerCase() === "asc";

  const buildQuery = (columns) => {
    let q = sb
      .from("admin_actions")
      .select(columns)
      .order(columns.includes("occurred_at") ? "occurred_at" : "created_at", { ascending })
      .limit(cappedLimit);
    if (actor) q = q.eq("actor_email", actor);
    if (action) q = q.eq("action", action);
    if (search) {
      const term = `%${search}%`;
      q = q.or(`actor_email.ilike.${term},action.ilike.${term}`);
    }
    return q;
  };

  const primaryCols = "id, occurred_at, actor_email, action, meta, payload";
  let { data, error } = await buildQuery(primaryCols);

  if (error && error.code === "42703") {
    const fallbackCols = "id, created_at, actor_email, action, meta, payload";
    const fallback = await buildQuery(fallbackCols);
    const { data: fallbackData, error: fallbackError } = await fallback;
    if (fallbackError) throw fallbackError;
    data = (fallbackData || []).map((row) => ({
      ...row,
      occurred_at: row.created_at,
    }));
  } else if (error) {
    throw error;
  }

  return (data || []).map((row) => ({
    ...row,
    meta: row.meta ?? row.payload ?? null,
  }));
}

export function getAuditClient() {
  return getServiceClient();
}
