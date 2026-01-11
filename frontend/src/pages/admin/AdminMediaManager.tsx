import React from "react";
import { api } from "../../lib/api";
import { useSettings } from "../../lib/SettingsContext";
import { resolveMediaUrl } from "../../utils/media";
import { useToast } from "../../components/ToastProvider";

type Stage = "draft" | "live";
type PathSegment = string | number;
type ReferenceInfo = { stage: Stage; description: string };
type ReferenceStatus =
  | { status: "loading" }
  | { status: "loaded"; references: ReferenceInfo[] }
  | { status: "error"; error: string };

type StorageUsage = {
  available: boolean;
  message?: string;
  totalBytes: number;
  quotaBytes?: number | null;
};

const STAGE_ORDER: Stage[] = ["draft", "live"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toTitleCase = (value: string): string =>
  value.replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const collectReferences = (settings: Record<string, unknown>, targetUrl: string): PathSegment[][] => {
  const matches: PathSegment[][] = [];
  if (!targetUrl) return matches;
  const trimmed = targetUrl.trim();
  const visit = (value: unknown, path: PathSegment[]) => {
    if (typeof value === "string") {
      if (value.trim() === trimmed) {
        matches.push(path);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, index]));
      return;
    }
    if (isRecord(value)) {
      Object.entries(value).forEach(([key, entry]) => visit(entry, [...path, key]));
    }
  };
  visit(settings, []);
  return matches;
};

const describeReference = (path: PathSegment[], settings: Record<string, unknown>): string => {
  if (path.length === 0) return "Unknown location";
  const [first, ...rest] = path;
  if (typeof first !== "string") {
    return path
      .map((segment) => (typeof segment === "number" ? `Item ${segment + 1}` : toTitleCase(segment.replace(/_/g, " "))))
      .join(" → ");
  }

  switch (first) {
    case "logo_url":
      return "General settings → Logo";
    case "favicon_url":
      return "General settings → Favicon";
    case "hero_image_url":
      return "Home page → Hero image";
    case "featured_video_url":
      return "Home page → Featured video";
    case "who_image_url":
      return "Home page → Who We Are image";
    case "media_sections": {
      const sectionIndex = typeof rest[0] === "number" ? rest[0] : -1;
      const sections = asArray<any>(settings["media_sections"]);
      const section = sectionIndex >= 0 ? sections[sectionIndex] : null;
      const sectionTitle =
        section && typeof section?.title === "string" && section.title.trim()
          ? section.title.trim()
          : `Section ${sectionIndex + 1}`;
      if (rest[1] === "items" && typeof rest[2] === "number") {
        const items = asArray<any>(section?.items);
        const itemIndex = rest[2];
        const item = items[itemIndex];
        const type = typeof item?.type === "string" ? item.type : "media";
        const typeLabel = type === "video" ? "Video" : type === "image" ? "Image" : "Media";
        const title =
          item && typeof item?.title === "string" && item.title.trim()
            ? item.title.trim()
            : `${typeLabel} ${itemIndex + 1}`;
        return `Media page → ${sectionTitle} → ${typeLabel}: ${title}`;
      }
      return `Media page → ${sectionTitle}`;
    }
    case "about_team": {
      const memberIndex = typeof rest[0] === "number" ? rest[0] : -1;
      const members = asArray<any>(settings["about_team"]);
      const member = memberIndex >= 0 ? members[memberIndex] : null;
      const name =
        member && typeof member?.name === "string" && member.name.trim()
          ? member.name.trim()
          : `Team member ${memberIndex + 1}`;
      return `About page → ${name} photo`;
    }
    case "people_profiles": {
      const memberIndex = typeof rest[0] === "number" ? rest[0] : -1;
      const members = asArray<any>(settings["people_profiles"]);
      const member = memberIndex >= 0 ? members[memberIndex] : null;
      const name =
        member && typeof member?.name === "string" && member.name.trim()
          ? member.name.trim()
          : `Person ${memberIndex + 1}`;
      const usage: string[] = [];
      if (member?.show_on_home) usage.push("Home carousel");
      if (member?.show_on_media) usage.push("Media carousel");
      const suffix = usage.length > 0 ? ` (${usage.join(", ")})` : "";
      return `About page → ${name} photo${suffix}`;
    }
    case "merch_items": {
      const itemIndex = typeof rest[0] === "number" ? rest[0] : -1;
      const items = asArray<any>(settings["merch_items"]);
      const item = itemIndex >= 0 ? items[itemIndex] : null;
      const title =
        item && typeof item?.title === "string" && item.title.trim()
          ? item.title.trim()
          : `Product ${itemIndex + 1}`;
      return `Merch page → ${title} image`;
    }
    default:
      break;
  }

  return path
    .map((segment) =>
      typeof segment === "number" ? `Item ${segment + 1}` : toTitleCase(String(segment).replace(/_/g, " "))
    )
    .join(" → ");
};

const SORT_OPTIONS = [
  { id: "newest", label: "Newest", sort: "updated_at", direction: "desc" },
  { id: "oldest", label: "Oldest", sort: "updated_at", direction: "asc" },
  { id: "name", label: "Name A–Z", sort: "name", direction: "asc" },
  { id: "name-desc", label: "Name Z–A", sort: "name", direction: "desc" },
  { id: "size", label: "Size", sort: "size", direction: "desc" },
];

const USAGE_FILTERS = [
  { id: "all", label: "All files" },
  { id: "used", label: "Used files" },
  { id: "unused", label: "Unused files" },
  { id: "people-home", label: "Home carousel" },
  { id: "people-media", label: "Media carousel" },
] as const;

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
  const toast = useToast();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [copiedPath, setCopiedPath] = React.useState(null);
  const [checkingPath, setCheckingPath] = React.useState<string | null>(null);
  const [referencesByPath, setReferencesByPath] = React.useState<Record<string, ReferenceStatus>>({});
  const [expandedPaths, setExpandedPaths] = React.useState<Record<string, boolean>>({});
  const [storageUsage, setStorageUsage] = React.useState<StorageUsage | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(false);
  const [storageError, setStorageError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [activeSortId, setActiveSortId] = React.useState(SORT_OPTIONS[0].id);
  const [usageFilter, setUsageFilter] = React.useState<(typeof USAGE_FILTERS)[number]["id"]>(
    USAGE_FILTERS[0].id
  );

  const activeSort = SORT_OPTIONS.find((s) => s.id === activeSortId) ?? SORT_OPTIONS[0];

  const { settings: activeSettings, stage: activeStage } = useSettings();
  const settingsCache = React.useRef<Partial<Record<Stage, Record<string, unknown>>>>({});

  const totalSize = React.useMemo(
    () => (items || []).reduce((sum, item) => sum + (typeof item?.size === "number" ? item.size : 0), 0),
    [items]
  );
  const usedBytes = storageUsage?.available ? storageUsage.totalBytes : totalSize;
  const quotaBytes = storageUsage?.quotaBytes ?? null;
  const usagePercent = quotaBytes ? Math.min(100, Math.max(0, Math.round((usedBytes / quotaBytes) * 100))) : null;

  const loadStorageUsage = React.useCallback(async () => {
    setStorageError(null);
    setStorageLoading(true);
    try {
      const response = await fetch(api("/api/admin/database/storage-usage"), { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const payload = (await response.json()) as StorageUsage;
      setStorageUsage(payload);
    } catch (err) {
      setStorageUsage(null);
      setStorageError((err as Error)?.message || "Failed to load storage usage");
    } finally {
      setStorageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (activeSettings) {
      settingsCache.current[activeStage as Stage] = activeSettings as Record<string, unknown>;
    }
  }, [activeSettings, activeStage]);

  React.useEffect(() => {
    loadStorageUsage();
  }, [loadStorageUsage]);

  const ensureStageSettings = React.useCallback(
    async (stage: Stage): Promise<Record<string, unknown>> => {
      if (settingsCache.current[stage]) {
        return settingsCache.current[stage] as Record<string, unknown>;
      }
      try {
        const response = await fetch(api(`/api/settings?stage=${stage}`), { credentials: "include" });
        const data = await response.json().catch(() => ({}));
        const sanitized = isRecord(data) ? (data as Record<string, unknown>) : {};
        settingsCache.current[stage] = sanitized;
        return sanitized;
      } catch (err) {
        console.error(`Failed to load ${stage} settings for dependency check`, err);
        const fallback = settingsCache.current[stage];
        return (fallback ? (fallback as Record<string, unknown>) : {});
      }
    },
    []
  );

  const findReferences = React.useCallback(
    async (targetUrl: string) => {
      if (!targetUrl) return [] as { stage: Stage; description: string }[];
      const references: ReferenceInfo[] = [];
      const seen = new Set<string>();
      for (const stage of STAGE_ORDER) {
        const settings = await ensureStageSettings(stage);
        if (!settings) continue;
        const matches = collectReferences(settings, targetUrl);
        matches.forEach((path) => {
          const description = describeReference(path, settings);
          const key = `${stage}:${description}`;
          if (!seen.has(key)) {
            seen.add(key);
            references.push({ stage, description });
          }
        });
      }
      return references;
    },
    [ensureStageSettings]
  );

  React.useEffect(() => {
    if (!items || items.length === 0) {
      setReferencesByPath({});
      return;
    }

    let cancelled = false;

    setReferencesByPath((prev) => {
      const next: Record<string, ReferenceStatus> = {};
      items.forEach((item) => {
        const path = item?.path;
        if (typeof path !== "string" || !path) return;
        const existing = prev[path];
        next[path] = existing && existing.status === "loaded" ? existing : { status: "loading" };
      });
      return next;
    });

    const loadReferences = async () => {
      const results = await Promise.all(
        items.map(async (item) => {
          const path = typeof item?.path === "string" ? item.path : "";
          if (!path) {
            return { path, status: { status: "loaded", references: [] as ReferenceInfo[] } as ReferenceStatus };
          }

          const url = typeof item?.url === "string" ? item.url.trim() : "";
          if (!url) {
            return { path, status: { status: "loaded", references: [] as ReferenceInfo[] } as ReferenceStatus };
          }

          try {
            const references = await findReferences(url);
            return { path, status: { status: "loaded", references } as ReferenceStatus };
          } catch (err) {
            console.error("Failed to load references for media item", err);
            return {
              path,
              status: {
                status: "error",
                error: "Could not determine where this file is used.",
              } as ReferenceStatus,
            };
          }
        })
      );

      if (cancelled) return;

      setReferencesByPath(() => {
        const next: Record<string, ReferenceStatus> = {};
        results.forEach(({ path, status }) => {
          if (!path) return;
          next[path] = status;
        });
        return next;
      });
    };

    loadReferences();

    return () => {
      cancelled = true;
    };
  }, [items, findReferences]);

  React.useEffect(() => {
    if (!items || items.length === 0) {
      setExpandedPaths({});
      return;
    }

    setExpandedPaths((prev) => {
      const next: Record<string, boolean> = {};
      items.forEach((item) => {
        const path = typeof item?.path === "string" ? item.path : "";
        if (!path) return;
        if (prev[path]) {
          next[path] = true;
        }
      });
      return next;
    });
  }, [items]);

  const toggleReferences = React.useCallback((path: string) => {
    if (!path) return;
    setExpandedPaths((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }, []);

  const renderReferences = React.useCallback(
    (item) => {
      const path = typeof item?.path === "string" ? item.path : "";
      if (!path) return null;

      const state = referencesByPath[path];
      if (!state) return null;

      if (state.status === "loading") {
        return <div className="text-xs text-neutral-500">Checking where this file is used…</div>;
      }

      if (state.status === "error") {
        return <div className="text-xs text-red-300">{state.error}</div>;
      }

      if (!state.references || state.references.length === 0) {
        return null;
      }

      const isExpanded = !!expandedPaths[path];

      return (
        <div className="overflow-hidden rounded border border-neutral-800/60 bg-neutral-900/40 text-xs">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-neutral-300 hover:bg-neutral-800/70"
            onClick={() => toggleReferences(path)}
            aria-expanded={isExpanded}
          >
            <span className="font-semibold uppercase tracking-wide text-neutral-400">Used in</span>
            <span className="flex items-center gap-2 text-neutral-500">
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-200">
                {state.references.length}
              </span>
              <span className="text-neutral-400">{isExpanded ? "−" : "+"}</span>
            </span>
          </button>
          {isExpanded && (
            <ul className="list-disc space-y-1 px-5 pb-3 pt-2 text-neutral-300">
              {state.references.map((reference, index) => {
                const stageLabel = reference.stage === "draft" ? "Draft" : "Live";
                return (
                  <li key={`${reference.stage}-${reference.description}-${index}`}>
                    <span className="font-semibold text-neutral-200">{stageLabel} settings:</span> {reference.description}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    },
    [expandedPaths, referencesByPath, toggleReferences]
  );

  const usageDataLoading = React.useMemo(() => {
    if (!items || items.length === 0) return false;
    return items.some((item) => {
      const path = typeof item?.path === "string" ? item.path : "";
      if (!path) return false;
      const state = referencesByPath[path];
      return !state || state.status !== "loaded";
    });
  }, [items, referencesByPath]);

  const filteredItems = React.useMemo(() => {
    if (!items) return [];
    if (usageFilter === "all") return items;

    return items.filter((item) => {
      const path = typeof item?.path === "string" ? item.path : "";
      const state = path ? referencesByPath[path] : undefined;
      if (!state || state.status !== "loaded") {
        return false;
      }

      const referenceCount = state.references?.length ?? 0;
      if (usageFilter === "used") {
        return referenceCount > 0;
      }

      if (usageFilter === "unused") {
        return referenceCount === 0;
      }

      const hasHomeCarousel = state.references?.some((reference) =>
        reference.description.includes("Home carousel")
      );
      const hasMediaCarousel = state.references?.some((reference) =>
        reference.description.includes("Media carousel")
      );
      if (usageFilter === "people-home") {
        return Boolean(hasHomeCarousel);
      }
      if (usageFilter === "people-media") {
        return Boolean(hasMediaCarousel);
      }

      return referenceCount === 0;
    });
  }, [items, referencesByPath, usageFilter]);

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
      const message = err?.message || "Unable to load media. Refresh and try again.";
      setError(message);
      toast({ kind: "error", text: message });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeSort.direction, activeSort.sort, search, toast]);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      load();
    }, 200);
    return () => clearTimeout(handle);
  }, [load]);

  const refresh = () => load();

  const onUpload = async (fileList: FileList | null | undefined) => {
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
      toast({ kind: "success", text: "Upload complete. Files are ready to use." });
    } catch (err) {
      console.error(err);
      const message = err?.message || "Upload failed. Check file size and try again.";
      setError(message);
      toast({ kind: "error", text: message });
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (item) => {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    let blocked = false;
    if (url) {
      setCheckingPath(item.path);
      try {
        const references = await findReferences(url);
        if (references.length > 0) {
          blocked = true;
          const message = [
            `“${item.name}” is still used in:`,
            ...references.map((reference) => {
              const stageLabel = reference.stage === "draft" ? "Draft" : "Live";
              return `• ${reference.description} (${stageLabel} settings)`;
            }),
            "",
            "Update those areas to use a different file, then try deleting again.",
          ].join("\n");
          window.alert(message);
        }
      } catch (err) {
        console.error("Failed to check media dependencies", err);
      } finally {
        setCheckingPath(null);
      }
    }

    if (blocked) return;

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
      toast({ kind: "success", text: "File deleted. References have been cleared." });
    } catch (err) {
      console.error(err);
      const message = err?.message || "Delete failed. Try again or check for active references.";
      setError(message);
      toast({ kind: "error", text: message });
    }
  };

  const onRename = async (item) => {
    const current = item.name;
    const suggestion = window.prompt("Rename file", current);
    if (suggestion == null) return;
    const trimmed = suggestion.trim();
    if (!trimmed || trimmed === current) return;

    try {
      setError(null);
      const response = await fetch(api("/api/storage/rename"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: item.path, toName: trimmed }),
      });
      const raw = await response.text();
      let payload: any = null;
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const message =
          (payload && (payload.error || payload.message)) || raw || "Rename failed";
        throw new Error(message);
      }
      await load();
      settingsCache.current = {};

      const totalUpdated = typeof payload?.totalUpdated === "number" ? payload.totalUpdated : 0;
      const replacements = (payload?.replacements ?? {}) as { draft?: number; live?: number };
      const draftCount = typeof replacements.draft === "number" ? replacements.draft : 0;
      const liveCount = typeof replacements.live === "number" ? replacements.live : 0;
      const detailParts: string[] = [];
      if (draftCount > 0) detailParts.push(`${draftCount} in Draft settings`);
      if (liveCount > 0) detailParts.push(`${liveCount} in Live settings`);

      const lines = [`Renamed “${current}” to “${trimmed}”.`];
      if (totalUpdated > 0) {
        lines.push(
          `Updated ${totalUpdated} reference${totalUpdated === 1 ? "" : "s"} across site settings automatically.`
        );
        if (detailParts.length > 0) {
          lines.push(detailParts.join(" · "));
        }
      } else {
        lines.push("No stored settings referenced the previous name.");
      }
      lines.push("All areas now use the renamed file.");
      window.alert(lines.join("\n"));
      toast({ kind: "success", text: "Rename complete. Settings references updated." });
    } catch (err) {
      console.error(err);
      const message = err?.message || "Rename failed. Try again with a different filename.";
      setError(message);
      toast({ kind: "error", text: message });
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
    toast({ kind: "success", text: "Media link copied to your clipboard." });
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
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-400">
            <div className="rounded-full border border-neutral-700 px-3 py-1">
              {items.length} file{items.length === 1 ? "" : "s"}
            </div>
            <div className="rounded-full border border-neutral-700 px-3 py-1">
              Used storage: {humanSize(usedBytes)}
            </div>
            {storageUsage?.quotaBytes ? (
              <div className="rounded-full border border-neutral-700 px-3 py-1">
                Remaining: {humanSize(Math.max(storageUsage.quotaBytes - usedBytes, 0))}
              </div>
            ) : null}
            {storageLoading ? (
              <div className="rounded-full border border-neutral-700 px-3 py-1">Checking storage…</div>
            ) : storageError ? (
              <div className="rounded-full border border-red-500/40 px-3 py-1 text-red-300">Storage lookup failed</div>
            ) : null}
          </div>
          {quotaBytes ? (
            <div className="mt-3 max-w-xl">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                <span>Storage usage</span>
                <span>{usagePercent}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-neutral-800">
                <div
                  className="h-2 rounded-full bg-yellow-400 transition-all"
                  style={{ width: `${Math.max(2, usagePercent || 0)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                <span>{humanSize(usedBytes)} used</span>
                <span>{humanSize(quotaBytes)} total</span>
              </div>
            </div>
          ) : null}
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

      <section className="grid gap-4 rounded border border-neutral-800 bg-neutral-900/70 p-4 md:grid-cols-2 xl:grid-cols-5">
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
        <div className="flex flex-col gap-2 text-sm md:col-span-2 xl:col-span-1">
          <span className="text-xs font-semibold uppercase text-neutral-500">Usage</span>
          <div className="flex flex-wrap gap-2">
            {USAGE_FILTERS.map((option) => (
              <button
                key={option.id}
                onClick={() => setUsageFilter(option.id)}
                className={`rounded-full px-3 py-1 text-sm ${
                  usageFilter === option.id
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
      ) : filteredItems.length === 0 && usageFilter !== "all" ? (
        <div className="space-y-2 text-sm text-neutral-400">
          <div>No media files match this filter.</div>
          {usageDataLoading && (
            <div className="text-xs text-neutral-500">
              Usage information is still loading. Files will appear here once their usage is determined.
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const previewUrl = resolveMediaUrl(item.url);

            return (
              <article key={item.path} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-sm">
                <div className="flex h-48 items-center justify-center bg-neutral-800">
                  {isImage(item.name, item.mime_type) ? (
                    <img src={previewUrl} alt={item.name} className="max-h-48 w-full object-contain" />
                  ) : isVideo(item.name, item.mime_type) ? (
                    <video src={previewUrl} controls preload="metadata" className="max-h-48 w-full object-contain" />
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
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                    <button
                      className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                      onClick={() => onRename(item)}
                    >
                      Rename
                    </button>
                    <button
                      className={`ml-auto rounded px-2 py-1 text-xs text-white transition ${
                        checkingPath === item.path
                          ? "cursor-wait bg-red-700/70"
                          : "bg-red-600 hover:bg-red-500"
                      }`}
                      onClick={() => onDelete(item)}
                      disabled={checkingPath === item.path}
                    >
                      {checkingPath === item.path ? "Checking…" : "Delete"}
                    </button>
                  </div>
                  {renderReferences(item)}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
