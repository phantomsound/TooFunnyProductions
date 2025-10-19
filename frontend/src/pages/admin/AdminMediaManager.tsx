// frontend/src/pages/admin/AdminMediaManager.tsx
// Lists files from Supabase Storage bucket and shows previews. Supports refresh and search.

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Item = {
  name: string;
  id: string;
  url: string;
  contentType: string;
  created_at?: string;
  size?: number;
};

const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || "media";

export default function AdminMediaManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"date" | "name">("date");

  const refresh = async () => {
    setLoading(true);
    // flat listing of the bucket root
    const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (error) {
      console.error("media list error", error);
      setItems([]);
      setLoading(false);
      return;
    }
    const withUrls: Item[] = await Promise.all(
      (data || []).map(async (f) => {
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(f.name);
        return {
          id: f.id || f.name,
          name: f.name,
          url: pub?.publicUrl || "",
          contentType: (f.metadata as any)?.mimetype || "",
          created_at: (f as any).created_at,
          size: (f as any).size,
        };
      })
    );
    setItems(withUrls);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    const g = (q || "").toLowerCase();
    let arr = items.filter(i => i.name.toLowerCase().includes(g));
    if (sort === "name") arr = arr.sort((a, b) => a.name.localeCompare(b.name));
    else arr = arr; // created_at already desc from list()
    return arr;
  }, [items, q, sort]);

  const isImage = (ct: string, name: string) =>
    ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);

  const isVideo = (ct: string, name: string) =>
    ct.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          placeholder="Search filename…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border px-3 py-2 rounded text-black"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as any)}
          className="border px-2 py-2 rounded text-black bg-white"
          title="Sort"
        >
          <option value="date">Sort: Date ↓</option>
          <option value="name">Sort: Name A→Z</option>
        </select>
        <button
          onClick={refresh}
          className="px-3 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="opacity-70">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="opacity-70">No media yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((f) => (
            <div key={f.id} className="rounded border bg-white text-black">
              <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                {isImage(f.contentType, f.name) ? (
                  <img src={f.url} alt={f.name} className="object-cover w-full h-full" />
                ) : isVideo(f.contentType, f.name) ? (
                  <video src={f.url} controls preload="metadata" className="object-cover w-full h-full" />
                ) : (
                  <div className="text-xs opacity-70 p-3">({f.contentType || "file"})</div>
                )}
              </div>
              <div className="p-3 space-y-2">
                <div className="text-sm font-semibold truncate" title={f.name}>{f.name}</div>
                <div className="flex gap-2">
                  <a href={f.url} target="_blank" rel="noreferrer" className="px-2 py-1 text-sm rounded border">Open</a>
                  <button
                    onClick={() => navigator.clipboard.writeText(f.url)}
                    className="px-2 py-1 text-sm rounded border"
                  >
                    Copy URL
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
