import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { api } from "../lib/api";
import { uploadMedia } from "../lib/uploadMedia";

export type MediaPickerItem = {
  name: string;
  path: string;
  url: string;
  mime_type: string | null;
  size: number | null;
  updated_at?: string | null;
};

type MediaPickerKind = "image" | "video" | "any";

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: MediaPickerItem) => void;
  kind?: MediaPickerKind;
}

const matchesKind = (item: MediaPickerItem, kind: MediaPickerKind) => {
  if (kind === "any") return true;
  const name = item.name.toLowerCase();
  const type = item.mime_type?.toLowerCase() || "";
  if (kind === "image") {
    return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  }
  if (kind === "video") {
    return type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name);
  }
  return true;
};

const MediaPickerModal: React.FC<MediaPickerModalProps> = ({ isOpen, onClose, onSelect, kind = "any" }) => {
  const [items, setItems] = useState<MediaPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          sort: "updated_at",
          direction: "desc",
        });
        if (search.trim()) params.set("q", search.trim());
        const response = await fetch(api(`/api/storage/list?${params.toString()}`), {
          credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `List failed: ${response.status}`);
        if (!cancelled) {
          const list = Array.isArray(payload.items) ? (payload.items as MediaPickerItem[]) : [];
          setItems(list);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load media";
          setError(message);
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, search, refreshIndex]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => matchesKind(item, kind));
  }, [items, kind]);

  useEffect(() => {
    if (!isOpen) {
      setUploadError(null);
      setUploading(false);
    }
  }, [isOpen]);

  const accept = useMemo(() => {
    if (kind === "image") return "image/*";
    if (kind === "video") return "video/*";
    return "*/*";
  }, [kind]);

  const handleUploadClick = () => {
    if (uploading) return;
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (uploading) return;
    const file = event.target.files?.[0];
    if (!file) {
      event.target.value = "";
      return;
    }

    try {
      setUploading(true);
      setUploadError(null);
      await uploadMedia(file);
      setRefreshIndex((index) => index + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadError(message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-4xl rounded-xl bg-neutral-900 text-neutral-100 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          aria-label="Close picker"
        >
          <X size={18} />
        </button>

        <div className="border-b border-neutral-800 px-6 py-4">
          <h3 className="text-lg font-semibold">Select media</h3>
          <p className="text-xs text-neutral-400">
            Showing files from the media bucket. Use search to narrow results.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search filenames…"
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-yellow-400 focus:outline-none sm:flex-1"
              autoFocus
            />
            <div className="flex flex-col gap-1 text-sm sm:w-60">
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={uploading}
                className={`rounded border px-3 py-2 font-semibold transition ${
                  uploading
                    ? "cursor-not-allowed border-neutral-700 bg-neutral-800 text-neutral-500"
                    : "border-yellow-400/60 bg-yellow-400/10 text-yellow-200 hover:border-yellow-300 hover:bg-yellow-400/20"
                }`}
              >
                {uploading ? "Uploading…" : "Upload from computer"}
              </button>
              {uploadError ? (
                <span className="text-xs text-red-400">{uploadError}</span>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={handleUploadChange}
            />
          </div>

          {error ? (
            <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="py-10 text-center text-sm text-neutral-400">Loading media…</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">No media files found.</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                  className="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/60 text-left transition hover:border-yellow-400"
                >
                  <div className="flex h-40 items-center justify-center bg-neutral-900">
                    {matchesKind(item, "image") ? (
                      <img
                        src={item.url}
                        alt={item.name}
                        className="max-h-40 w-full object-contain"
                      />
                    ) : matchesKind(item, "video") ? (
                      <video
                        src={item.url}
                        className="max-h-40 w-full object-contain"
                        controls={false}
                        preload="metadata"
                      />
                    ) : (
                      <span className="truncate px-4 text-xs text-neutral-400">{item.name}</span>
                    )}
                  </div>
                  <div className="space-y-1 px-4 py-3 text-sm">
                    <div className="truncate font-semibold text-neutral-100 group-hover:text-yellow-300">
                      {item.name}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {item.size ? `${Math.round(item.size / 1024)} KB` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaPickerModal;
