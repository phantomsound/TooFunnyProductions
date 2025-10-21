import React from "react";
import { api } from "../../lib/api";

const SORT_OPTIONS = [
  { id: "newest", label: "Newest", sort: "updated_at", direction: "desc" },
  { id: "oldest", label: "Oldest", sort: "updated_at", direction: "asc" },
  { id: "name", label: "Name A–Z", sort: "name", direction: "asc" },
  { id: "name-desc", label: "Name Z–A", sort: "name", direction: "desc" },
  { id: "size", label: "Size", sort: "size", direction: "desc" },
];

const humanSize = (n) => {
  if (n == null) return "";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[idx]}`;
};

const isImage = (name, mime) =>
  (mime && mime.startsWith("image/")) || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
const isVideo = (name, mime) =>
  (mime && mime.startsWith("video/")) || /\.(mp4|webm|mov|m4v)$/i.test(name);

export default function AdminMediaManager() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [copiedPath, setCopiedPath] = React.useState(null);

  const [search, setSearch] = React.useState("");
  const [activeSortId, setActiveSortId] = React.useState(SORT_OPTIONS[0].id);

  const activeSort = SORT_OPTIONS.find((s) => s.id === activeSortId) ?? SORT_OPTIONS[0];

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("sort", activeSort.sort);
      params.set("direction", activeSort.direction);
      if (search.trim()) params.set("q", search.trim());

      const response = await fetch(api(`/api/storage/list?${params.toString()}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`List failed: ${response.status}`);

      const data = await response.json();
      setItems(data?.items || []);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to load media");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeSort.direction, activeSort.sort, search]);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      load();
    }, 200);
    return () => clearTimeout(handle);
  }, [load]);

  const refresh = () => load();

  const onUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(api("/api/storage/upload"), {
          method: "POST",
          body: form,
          credentials: "include",
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Failed to upload ${file.name}`);
        }
      }
      await load();
    } catch (err) {
      console.error(err);
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (item) => {
    if (!window.confirm(`Delete \"${item.name}\"? This cannot be undone.`)) return;
    try {
      const response = await fetch(api("/api/storage/delete"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path }),
      });
      if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
      setItems((prev) => prev.filter((it) => it.path !== item.path));
    } catch (err) {
      console.error(err);
      setError(err?.message || "Delete failed");
    }
  };

  const onRename = async (item) => {
    const current = item.name;
    const suggestion = window.prompt("Rename file", current);
    if (!suggestion || suggestion === current) return;

    try {
      const response = await fetch(api("/api/storage/rename"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: item.path, toName: suggestion }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Rename failed");
      }
      await load();
    } catch (err) {
      console.error(err);
      setError(err?.message || "Rename failed");
    }
  };

  const onCopy = async (item) => {
    const { url, path } = item;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy URL", url);
    }
    setCopiedPath(path);
    window.setTimeout(() => setCopiedPath((prev) => (prev === path ? null : prev)), 2000);
  };

  return (
    <div className="space-y-6 text-neutral-100">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-yellow-300">Media Manager</h2>
          <p className="text-sm text-neutral-400">
            Upload, rename, and organize assets stored in the Supabase media bucket. Folders are hidden so everything is
            flat and searchable.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded bg-yellow-400 px-3 py-2 text-sm font-semibold text-black hover:bg-yellow-300">
            {uploading ? "Uploading…" : "Upload files"}
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                onUpload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <button
            className="rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="grid gap-4 rounded border border-neutral-800 bg-neutral-900/70 p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold uppercase text-neutral-500">Search</span>
          <input
            className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500"
            placeholder="Filename contains…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-2 text-sm md:col-span-1 xl:col-span-2">
          <span className="text-xs font-semibold uppercase text-neutral-500">Sort</span>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setActiveSortId(option.id)}
                className={`rounded-full px-3 py-1 text-sm ${
                  activeSortId === option.id
                    ? "bg-neutral-100 text-neutral-900"
                    : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end justify-end">
          {search && (
            <button
              className="text-sm text-neutral-400 underline hover:text-neutral-200"
              onClick={() => setSearch("")}
            >
              Clear search
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-400">Loading media…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-neutral-400">No media files found.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={item.path} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-sm">
              <div className="flex h-48 items-center justify-center bg-neutral-800">
                {isImage(item.name, item.mime_type) ? (
                  <img src={item.url} alt={item.name} className="max-h-48 w-full object-contain" />
                ) : isVideo(item.name, item.mime_type) ? (
                  <video src={item.url} controls preload="metadata" className="max-h-48 w-full object-contain" />
                ) : (
                  <span className="truncate px-4 text-xs text-neutral-400">{item.name}</span>
                )}
              </div>
              <div className="space-y-2 p-4 text-sm">
                <div className="truncate font-semibold text-neutral-100" title={item.name}>
                  {item.name}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <span>{humanSize(item.size)}</span>
                  <span>•</span>
                  <span>{new Date(item.updated_at || item.created_at || Date.now()).toLocaleString()}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                    onClick={() => onCopy(item)}
                  >
                    {copiedPath === item.path ? "Copied!" : "Copy URL"}
                  </button>
                  <a
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                  <button
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                    onClick={() => onRename(item)}
                  >
                    Rename
                  </button>
                  <button
                    className="ml-auto rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                    onClick={() => onDelete(item)}
                  >
                    Delete
                  </button>
                  <a
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                  <button
                    className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                    onClick={() => onRename(item)}
                  >
                    Rename
                  </button>
                  <button
                    className="ml-auto rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                    onClick={() => onDelete(item)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
