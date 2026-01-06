// backend/lib/storageUsage.js
import { getSupabaseServiceContext } from "./supabaseClient.js";

const FALLBACK_LABEL = "Other";

const normalizeSize = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const categorizeMime = (mime, name) => {
  const lowerMime = typeof mime === "string" ? mime.toLowerCase() : "";
  const lowerName = typeof name === "string" ? name.toLowerCase() : "";
  if (lowerMime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(lowerName)) return "Images";
  if (lowerMime.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(lowerName)) return "Videos";
  if (lowerMime.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac)$/i.test(lowerName)) return "Audio";
  if (
    lowerMime.includes("pdf") ||
    lowerMime.includes("json") ||
    lowerMime.includes("text") ||
    /\.(pdf|docx?|csv|txt|json)$/i.test(lowerName)
  )
    return "Documents";
  return FALLBACK_LABEL;
};

export async function getStorageUsage() {
  const { client } = await getSupabaseServiceContext();
  if (!client) {
    return {
      available: false,
      message: "Supabase storage is not configured.",
      totalBytes: 0,
      databaseBytes: null,
      databaseMessage: "Supabase client unavailable.",
      buckets: [],
      categories: [],
    };
  }

  try {
    let databaseBytes = null;
    let databaseMessage = null;

    try {
      const { data: databaseSize, error: databaseError } = await client.rpc("get_database_size");
      if (databaseError) {
        databaseMessage = "Database size function missing. Run the database size SQL helper to enable this.";
      } else if (typeof databaseSize === "number") {
        databaseBytes = databaseSize;
      }
    } catch (err) {
      databaseMessage = "Database size function missing. Run the database size SQL helper to enable this.";
    }

    const { data, error } = await client.from("storage.objects").select("bucket_id,name,metadata");
    if (error) throw error;

    const bucketTotals = new Map();
    const categoryTotals = new Map();
    let totalBytes = 0;

    (data || []).forEach((row) => {
      const size = normalizeSize(row?.metadata?.size ?? row?.metadata?.contentLength);
      if (!size) return;
      totalBytes += size;

      const bucket = row?.bucket_id || "unknown";
      bucketTotals.set(bucket, (bucketTotals.get(bucket) || 0) + size);

      const label = categorizeMime(row?.metadata?.mimetype, row?.name);
      categoryTotals.set(label, (categoryTotals.get(label) || 0) + size);
    });

    const buckets = Array.from(bucketTotals.entries())
      .map(([bucketId, bytes]) => ({ bucketId, bytes }))
      .sort((a, b) => b.bytes - a.bytes);

    const categories = Array.from(categoryTotals.entries())
      .map(([label, bytes]) => ({ label, bytes }))
      .sort((a, b) => b.bytes - a.bytes);

    return {
      available: true,
      totalBytes,
      databaseBytes,
      databaseMessage,
      buckets,
      categories,
    };
  } catch (err) {
    console.error("Failed to compute storage usage", err);
    return {
      available: false,
      message: err?.message || "Storage usage unavailable.",
      totalBytes: 0,
      databaseBytes: null,
      databaseMessage: err?.message || "Storage usage unavailable.",
      buckets: [],
      categories: [],
    };
  }
}
