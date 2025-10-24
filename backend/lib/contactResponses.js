// backend/lib/contactResponses.js
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const LOCAL_STORE_PATH = join(DATA_DIR, "contact-responses.json");

let _sb = null;
function getServiceClient() {
  if (_sb) return _sb;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return null;
  }
  _sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _sb;
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readLocalStore() {
  try {
    const raw = await readFile(LOCAL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeRecord).filter(Boolean);
    }
    return [];
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.warn("⚠️ Failed to read local contact response store:", err?.message || err);
    }
    return [];
  }
}

async function writeLocalStore(records) {
  try {
    await ensureDataDir();
    await writeFile(LOCAL_STORE_PATH, JSON.stringify(records, null, 2));
  } catch (err) {
    console.error("❌ Failed to persist contact responses locally:", err?.message || err);
  }
}

function normalizeRecord(input) {
  if (!input || typeof input !== "object") return null;
  const record = { ...input };
  record.id = record.id || randomUUID();
  record.created_at = record.created_at || new Date().toISOString();
  record.updated_at = record.updated_at || record.created_at;
  record.name = String(record.name || "").trim();
  record.email = String(record.email || "").trim();
  record.message = String(record.message || "").trim();
  record.responded = Boolean(record.responded);
  record.responded_at = record.responded_at ?? null;
  record.responded_by = record.responded_by ?? null;
  record.notes = typeof record.notes === "string" ? record.notes : "";
  record.delivery_status = record.delivery_status || "pending";
  record.delivery_error = typeof record.delivery_error === "string" ? record.delivery_error : null;
  record.meta = record.meta && typeof record.meta === "object" ? record.meta : {};
  return record;
}

function normalizeForStorage(record) {
  return {
    id: record.id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    name: record.name,
    email: record.email,
    message: record.message,
    responded: record.responded,
    responded_at: record.responded_at,
    responded_by: record.responded_by,
    notes: record.notes,
    delivery_status: record.delivery_status,
    delivery_error: record.delivery_error,
    meta: record.meta,
  };
}

function buildRecord({ name, email, message, meta }) {
  const now = new Date().toISOString();
  return normalizeRecord({
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    name,
    email,
    message,
    responded: false,
    responded_at: null,
    responded_by: null,
    notes: "",
    delivery_status: "pending",
    delivery_error: null,
    meta: meta || {},
  });
}

function normalizeBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["1", "true", "yes"].includes(trimmed)) return true;
    if (["0", "false", "no"].includes(trimmed)) return false;
  }
  return undefined;
}

export async function recordContactResponse({ name, email, message, meta = {} }) {
  const record = buildRecord({ name, email, message, meta });

  const sb = getServiceClient();
  if (sb) {
    try {
      const insertPayload = normalizeForStorage(record);
      const { error } = await sb.from("contact_responses").insert([insertPayload]);
      if (!error) {
        return record;
      }
      console.warn("⚠️ Failed to insert contact response into Supabase, falling back to local store:", error?.message || error);
    } catch (err) {
      console.warn("⚠️ Supabase contact response insert threw, falling back to local store:", err?.message || err);
    }
  }

  const existing = await readLocalStore();
  existing.push(record);
  existing.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  await writeLocalStore(existing.map(normalizeForStorage));
  return record;
}

export async function updateContactResponse(id, patch = {}) {
  if (!id) throw new Error("Missing contact response id");
  const safePatch = { ...patch };
  if (safePatch.responded !== undefined) {
    safePatch.responded = Boolean(safePatch.responded);
    safePatch.responded_at = safePatch.responded ? safePatch.responded_at || new Date().toISOString() : null;
    if (!safePatch.responded) {
      safePatch.responded_by = null;
    }
  }
  if (safePatch.notes !== undefined && typeof safePatch.notes !== "string") {
    safePatch.notes = String(safePatch.notes);
  }
  safePatch.updated_at = new Date().toISOString();

  const sb = getServiceClient();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("contact_responses")
        .update(safePatch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (!error) {
        return normalizeRecord(data);
      }
      console.warn("⚠️ Failed to update contact response in Supabase, falling back to local store:", error?.message || error);
    } catch (err) {
      console.warn("⚠️ Supabase contact response update threw, falling back to local store:", err?.message || err);
    }
  }

  const records = await readLocalStore();
  const idx = records.findIndex((row) => row.id === id);
  if (idx === -1) {
    throw new Error("Contact response not found");
  }
  const merged = normalizeRecord({ ...records[idx], ...safePatch });
  records[idx] = normalizeForStorage(merged);
  await writeLocalStore(records);
  return merged;
}

export async function listContactResponses({ search, responded, limit = 50, offset = 0, sort = "newest" } = {}) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const respondedFilter = normalizeBoolean(responded);
  const ascending = String(sort).toLowerCase() === "oldest";

  const sb = getServiceClient();
  if (sb) {
    try {
      let query = sb
        .from("contact_responses")
        .select(
          "id, created_at, updated_at, name, email, message, responded, responded_at, responded_by, notes, delivery_status, delivery_error, meta",
          { count: "exact" }
        )
        .order("created_at", { ascending });

      if (respondedFilter !== undefined) {
        query = query.eq("responded", respondedFilter);
      }
      if (search && String(search).trim()) {
        const term = `%${String(search).trim()}%`;
        query = query.or(`name.ilike.${term},email.ilike.${term},message.ilike.${term}`);
      }

      const to = normalizedOffset + normalizedLimit - 1;
      query = query.range(normalizedOffset, to);

      const { data, error, count } = await query;
      if (!error) {
        return {
          items: (data || []).map(normalizeRecord),
          total: typeof count === "number" ? count : (data || []).length,
        };
      }
      console.warn("⚠️ Failed to read contact responses from Supabase, falling back to local store:", error?.message || error);
    } catch (err) {
      console.warn("⚠️ Supabase contact response query threw, falling back to local store:", err?.message || err);
    }
  }

  const records = await readLocalStore();
  const filtered = records
    .map(normalizeRecord)
    .filter(Boolean)
    .filter((row) => {
      if (respondedFilter !== undefined && Boolean(row.responded) !== respondedFilter) return false;
      if (search && String(search).trim()) {
        const term = String(search).trim().toLowerCase();
        const haystack = `${row.name}\n${row.email}\n${row.message}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return ascending ? aTime - bTime : bTime - aTime;
    });

  const paged = filtered.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  return { items: paged, total: filtered.length };
}

export async function exportContactResponses(options = {}) {
  const { items } = await listContactResponses({ ...options, limit: 5000, offset: 0 });
  const header = [
    "ID",
    "Received At",
    "Name",
    "Email",
    "Message",
    "Responded",
    "Responded At",
    "Responded By",
    "Notes",
    "Delivery Status",
    "Delivery Error",
  ];

  const lines = [header.join(",")];
  for (const row of items) {
    const values = [
      row.id,
      row.created_at,
      escapeCsv(row.name),
      escapeCsv(row.email),
      escapeCsv(row.message),
      row.responded ? "yes" : "no",
      row.responded_at || "",
      escapeCsv(row.responded_by || ""),
      escapeCsv(row.notes || ""),
      row.delivery_status || "",
      escapeCsv(row.delivery_error || ""),
    ];
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value).replace(/\r?\n|\r/g, " ");
  if (/[",]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export async function noteDeliveryStatus(id, status, errorMessage = null) {
  const patch = {
    delivery_status: status,
    delivery_error: errorMessage,
  };
  return updateContactResponse(id, patch);
}
