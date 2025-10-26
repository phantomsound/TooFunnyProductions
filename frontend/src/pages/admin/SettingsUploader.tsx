import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import MediaPickerModal, {
  type MediaPickerItem,
} from "../../components/MediaPickerModal";
import { resolveMediaUrl } from "../../utils/media";

type SettingsUploaderProps = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  buttonLabel?: string;
  disabled?: boolean;
  pickerKind?: "image" | "video" | "any";
  allowLibrary?: boolean;
  appearance?: "dark" | "light";
  layout?: "auto" | "stacked" | "inline";
};

type UploadError = string | null;

export default function SettingsUploader({
  label,
  value,
  onChange,
  accept = "*",
  buttonLabel = "Upload",
  disabled = false,
  pickerKind,
  allowLibrary = true,
  appearance = "dark",
  layout = "auto",
}: SettingsUploaderProps): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<UploadError>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(value || "");
  const [showLibrary, setShowLibrary] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [pendingIsImage, setPendingIsImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const derivedPickerKind = useMemo(() => {
    if (pickerKind) return pickerKind;
    const normalized = accept.toLowerCase();
    if (normalized.includes("video")) return "video";
    if (normalized.includes("image")) return "image";
    return "any";
  }, [accept, pickerKind]);

  useEffect(() => {
    setPreviewUrl(value || "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const resetSelection = (nextPreview: string | undefined) => {
    setPendingName(null);
    setPendingIsImage(false);
    setPreviewUrl(nextPreview ?? "");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || uploading) return;
    setError(null);
    const next = event.target.files?.[0] ?? null;
    if (!next) {
      resetSelection(value || "");
      return;
    }
    setPendingName(next.name);
    setPendingIsImage(next.type.startsWith("image/"));
    const objectUrl = URL.createObjectURL(next);
    objectUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
    void uploadSelectedFile(next);
  };

  const uploadSelectedFile = async (selected: File) => {
    if (disabled) return;

    try {
      setUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append("file", selected);

      const response = await fetch(api("/api/storage/upload"), {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const out = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok) {
        throw new Error(out?.error || "Upload failed");
      }

      if (typeof out.url === "string") {
        onChange(out.url);
        resetSelection(out.url);
        setPreviewUrl(out.url);
      } else {
        throw new Error("Upload response missing url");
      }
    } catch (err: unknown) {
      console.error("Upload error", err);
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message || "Upload failed");
      resetSelection(value || "");
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    if (disabled) return;
    resetSelection("");
    onChange("");
  };

  const handleLibrarySelect = (item: MediaPickerItem) => {
    if (disabled) return;
    const url = item.url;
    onChange(url);
    resetSelection(url);
  };

  const isImage =
    pendingIsImage ||
    (!!previewUrl && /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(previewUrl.split("?")[0] ?? ""));

  const resolvedPreviewUrl = resolveMediaUrl(previewUrl);
  const hasPreview = Boolean(previewUrl);

  const resourceName = useMemo(() => {
    if (!buttonLabel) return "file";
    const cleaned = buttonLabel
      .replace(/from computer/gi, "")
      .replace(/upload|select|choose/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > 0 ? cleaned.toLowerCase() : "file";
  }, [buttonLabel]);

  const resourceTitle = useMemo(
    () => resourceName.replace(/(^\w|\s\w)/g, (match) => match.toUpperCase()),
    [resourceName]
  );

  const resourceArticle = useMemo(() => (resourceName.match(/^[aeiou]/i) ? "an" : "a"), [resourceName]);

  const currentFileDisplay = useMemo(() => {
    if (pendingName) return pendingName;
    if (!value) return "No file selected";
    try {
      const url = new URL(value);
      const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
      return url.hostname || value;
    } catch {
      const segments = value.split("/").filter(Boolean);
      return segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : value;
    }
  }, [pendingName, value]);

  const statusMessage = useMemo(() => {
    if (pendingName) {
      return uploading
        ? `Uploading ${resourceArticle} ${resourceName}…`
        : `${resourceTitle} selected`;
    }
    if (value) return `${resourceTitle} currently in use`;
    return `Select ${resourceArticle} ${resourceName} to upload`;
  }, [pendingName, uploading, resourceArticle, resourceName, resourceTitle, value]);

  const interactionsDisabled = disabled || uploading;

  const palette = appearance === "light"
    ? {
        container: "space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-sm",
        label: "text-sm font-semibold uppercase tracking-wide text-gray-500",
        clearButton: interactionsDisabled
          ? "text-xs font-semibold text-red-400/60 cursor-not-allowed"
          : "text-xs font-semibold text-red-600 hover:text-red-500",
        chooseButton: interactionsDisabled
          ? "rounded px-3 py-2 text-sm font-semibold cursor-not-allowed bg-gray-100 text-gray-400"
          : "rounded px-3 py-2 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500",
        fileSummary: "flex-1 rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs leading-tight text-gray-600",
        fileSummaryTitle: "truncate font-semibold text-gray-900",
        fileSummaryStatus: "text-[11px] text-gray-500",
        browseButton: interactionsDisabled
          ? "w-full rounded border px-3 py-2 text-sm font-semibold cursor-not-allowed border-gray-200 text-gray-400"
          : "w-full rounded border px-3 py-2 text-sm font-semibold border-gray-300 text-gray-700 hover:border-blue-300 hover:text-blue-600",
        preview: "w-full rounded-md border border-gray-200 bg-gray-50 p-3 lg:max-w-[220px] lg:justify-self-end",
        previewPlaceholder: "flex h-40 items-center justify-center text-xs text-gray-400",
        previewImage: "mx-auto max-h-40 rounded-md object-cover",
        previewText: "break-all text-xs text-gray-600",
        statusRow: "flex flex-wrap items-center gap-3",
        uploadingText: "text-xs text-gray-500",
        viewButton: "rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:text-blue-600",
        error: "text-xs text-red-500",
      }
    : {
        container: "space-y-4 rounded-lg border border-neutral-800 bg-neutral-900/80 p-4 text-neutral-100 shadow-sm",
        label: "text-sm font-semibold uppercase tracking-wide text-neutral-300",
        clearButton: interactionsDisabled
          ? "text-xs font-semibold cursor-not-allowed text-red-400/60"
          : "text-xs font-semibold text-red-300 hover:text-red-200",
        chooseButton: interactionsDisabled
          ? "rounded px-3 py-2 text-sm font-semibold cursor-not-allowed bg-neutral-800 text-neutral-500"
          : "rounded px-3 py-2 text-sm font-semibold bg-yellow-400 text-black hover:bg-yellow-300",
        fileSummary: "flex-1 rounded border border-dashed border-neutral-700 bg-neutral-950/50 px-3 py-2 text-xs leading-tight text-neutral-300",
        fileSummaryTitle: "truncate font-semibold text-neutral-100",
        fileSummaryStatus: "text-[11px] text-neutral-400",
        browseButton: interactionsDisabled
          ? "w-full rounded border px-3 py-2 text-sm font-semibold cursor-not-allowed border-neutral-700 text-neutral-500"
          : "w-full rounded border px-3 py-2 text-sm font-semibold border-neutral-700 text-neutral-200 transition hover:border-yellow-300 hover:text-yellow-200",
        preview: "w-full rounded-md border border-neutral-800 bg-neutral-950/60 p-3 lg:max-w-sm lg:justify-self-end",
        previewPlaceholder: "flex h-40 items-center justify-center text-xs text-neutral-500",
        previewImage: "mx-auto max-h-40 object-contain",
        previewText: "break-all text-xs text-neutral-300",
        statusRow: "flex flex-wrap items-center gap-3",
        uploadingText: "text-xs text-neutral-400",
        viewButton: "rounded border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:border-yellow-300 hover:text-yellow-200",
        error: "text-xs text-red-400",
      };

  const layoutClasses = useMemo(() => {
    if (layout === "inline") {
      return "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] lg:items-start lg:gap-6";
    }

    if (layout === "stacked") {
      return "grid gap-4";
    }

    // auto: prefer stacked layout except on very wide screens where there is ample room
    return "grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] xl:items-start xl:gap-6";
  }, [layout]);

  return (
    <div className={palette.container}>
      <div className="flex items-center justify-between gap-3">
        <p className={palette.label}>{label}</p>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={interactionsDisabled}
            className={palette.clearButton}
          >
            Clear
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
        disabled={interactionsDisabled}
      />

      <div className={layoutClasses}>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => {
                if (!interactionsDisabled) fileInputRef.current?.click();
              }}
              disabled={interactionsDisabled}
              className={palette.chooseButton}
            >
              {`Choose ${resourceTitle} from computer`}
            </button>

            <div className={palette.fileSummary}>
              <p className={palette.fileSummaryTitle}>{currentFileDisplay}</p>
              <p className={palette.fileSummaryStatus}>{statusMessage}</p>
            </div>
          </div>

          {allowLibrary ? (
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              disabled={interactionsDisabled}
              className={palette.browseButton}
            >
              Browse media library
            </button>
          ) : null}
        </div>

        <div className={palette.preview}>
          {hasPreview ? (
            isImage ? (
              <img src={resolvedPreviewUrl} alt="Preview" className={palette.previewImage} />
            ) : (
              <p className={palette.previewText}>{previewUrl}</p>
            )
          ) : (
            <div className={palette.previewPlaceholder}>
              No file selected yet.
            </div>
          )}
        </div>
      </div>

      {error ? <p className={palette.error}>{error}</p> : null}

      <div className={palette.statusRow}>
        {uploading ? <span className={palette.uploadingText}>Uploading…</span> : null}
        {value ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className={palette.viewButton}
          >
            View current
          </a>
        ) : null}
      </div>
      <MediaPickerModal
        isOpen={showLibrary && !disabled}
        onClose={() => setShowLibrary(false)}
        onSelect={handleLibrarySelect}
        kind={derivedPickerKind}
      />
    </div>
  );
}
