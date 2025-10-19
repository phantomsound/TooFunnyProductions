// frontend/src/components/admin/MediaManager.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { api } from "../../lib/api";

type Item = {
  name: string;
  path: string;   // same as name at root
  url: string;    // public URL
  size?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  isFolder?: boolean;
};

const BUCKET = "media";

const human = (n?: number | null) => {
  if (!n && n !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, x = n!;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(1)} ${units[i]}`;
};

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
const isVideo = (name: string) => /\.(mp4|webm|ogg|mov|m4v)$/i.test(name);

const MediaManager: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sort, setSort] = useState<"name" | "date" | "size">("date");
  const [asc, setAsc] = useState(false);
  const page = useRef(0);

  const listFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).list("", {
        limit: 1000,
        offset: page.current * 1000,
        search: search || undefined,
      });
      if (error) throw error;

      const mapped: Item[] = (data || [])
        .map((d: any) => {
          const isFolder = d.id == null && !d.metadata;
          const path = d.name;
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
          return {
            name: d.name,
            path,
            url: pub.publicUrl,
            size: d.metadata?.size ?? null,
            updated_at: d.updated_at || d.created_at || null,
            created_at: d.created_at || null,
            isFolder,
          };
        })
        // hide folders for now
        .filter((x) => !x.isFolder);

      setItems(mapped);
    } catch (e) {
      console.error("List error:", e);
      alert("Failed to list files");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { listFiles(); }, []);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    page.current = 0;
    await listFiles();
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (error) throw error;
      }
      await listFiles();
      alert("✅ Upload complete");
    } catch (e) {
      console.error("Upload error:", e);
      alert("❌ Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (item: Item) => {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([item.path]);
      if (error) throw error;
      setItems((prev) => prev.filter((i) => i.path !== item.path));
    } catch (e) {
      console.error("Delete error:", e);
      alert("❌ Delete failed");
    }
  };

  const onCopy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); alert("📋 URL copied"); }
    catch { alert(url); }
  };

  const onRename = async (item: Item) => {
    const base = item.name.replace(/^.*\//, "");
    const newName = prompt("New filename (keep extension):", base);
    if (!newName || newName === base) return;

    const newPath = newName; // root
    try {
      // 1) download → upload new → remove old
      const { data: fileData, error: dlErr } = await supabase.storage.from(BUCKET).download(item.path);
      if (dlErr) throw dlErr;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, fileData, { upsert: true });
      if (upErr) throw upErr;

      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([item.path]);
      if (rmErr) throw rmErr;

      // 2) update references in settings if they exactly match the old URL
      const { data: pubNew } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
      const newUrl = pubNew.publicUrl;

      try {
        const res = await fetch(api("/api/settings"), { credentials: "include" });
        const row = await res.json();
        const patch: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === "string" && v === item.url) patch[k] = newUrl;
        }
        const keys = Object.keys(patch);
        if (keys.length) {
          await fetch(api("/api/settings"), {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
        }
      } catch (e) {
        console.warn("Reference update skipped/failed", e);
      }

      await listFiles();
      alert("✅ Renamed");
    } catch (e) {
      console.error("Rename error:", e);
      alert("❌ Rename failed");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      let v = 0;
      if (sort === "name") v = a.name.localeCompare(b.name);
      if (sort === "date")
        v = new Date(a.updated_at || a.created_at || 0).getTime() -
            new Date(b.updated_at || b.created_at || 0).getTime();
      if (sort === "size") v = (a.size || 0) - (b.size || 0);
      return asc ? v : -v;
    });
    return arr;
  }, [items, sort, asc]);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Media Manager</h2>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename…"
            className="border rounded p-2 w-72 text-black"
          />
          <button className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-700" type="submit">
            Search
          </button>
          <button className="px-3 py-2 rounded border" type="button" onClick={() => { setSearch(""); listFiles(); }}>
            Clear
          </button>
        </form>

        <div className="flex items-center gap-2 ml-auto">
          <label className="px-3 py-2 rounded bg-yellow-500 text-black hover:bg-yellow-400 cursor-pointer">
            {uploading ? "Uploading…" : "Upload"}
            <input type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </label>

          <select
            className="border rounded p-2 text-black"
            value={`${sort}:${asc ? "asc" : "desc"}`}
            onChange={(e) => {
              const [s, dir] = e.target.value.split(":") as any;
              setSort(s);
              setAsc(dir === "asc");
            }}
          >
            <option value="date:desc">Sort: Date ↓</option>
            <option value="date:asc">Sort: Date ↑</option>
            <option value="name:asc">Sort: Name A–Z</option>
            <option value="name:desc">Sort: Name Z–A</option>
            <option value="size:desc">Sort: Size ↓</option>
            <option value="size:asc">Sort: Size ↑</option>
          </select>

          <button className="px-3 py-2 rounded border" onClick={listFiles} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((it) => (
          <div key={it.path} className="rounded-lg border bg-white text-black overflow-hidden shadow">
            <div className="h-40 bg-gray-100 grid place-items-center">
              {isImage(it.name) ? (
                <img src={it.url} alt={it.name} className="max-h-40 object-contain" />
              ) : isVideo(it.name) ? (
                <video src={it.url} className="max-h-40" controls preload="metadata" />
              ) : (
                <div className="text-sm text-gray-500 p-4 break-all">{it.name}</div>
              )}
            </div>
            <div className="p-3">
              <div className="font-medium truncate" title={it.name}>{it.name}</div>
              <div className="text-xs text-gray-500">
                {new Date(it.updated_at || it.created_at || Date.now()).toLocaleString()}
                {it.size ? ` • ${human(it.size)}` : ""}
              </div>
              <div className="flex gap-2 mt-3">
                <button className="px-2 py-1 text-xs rounded bg-gray-900 text-white" onClick={() => onCopy(it.url)}>
                  Copy URL
                </button>
                <a className="px-2 py-1 text-xs rounded border" href={it.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button className="px-2 py-1 text-xs rounded border" onClick={() => onRename(it)}>
                  Rename
                </button>
                <button className="ml-auto px-2 py-1 text-xs rounded bg-red-600 text-white" onClick={() => onDelete(it)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {sorted.length === 0 && !loading && <div className="text-gray-500">No files found.</div>}
      </div>
    </div>
  );
};

export default MediaManager;
