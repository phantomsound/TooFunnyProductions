import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import MediaPickerModal, {
  type MediaPickerItem,
} from "../../components/MediaPickerModal";

type SettingsUploaderProps = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  buttonLabel?: string;
  disabled?: boolean;
  pickerKind?: "image" | "video" | "any";
  allowLibrary?: boolean;
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
}: SettingsUploaderProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<UploadError>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(value || "");
  const [showLibrary, setShowLibrary] = useState(false);

  const derivedPickerKind = useMemo(() => {
    if (pickerKind) return pickerKind;
    const normalized = accept.toLowerCase();
    if (normalized.includes("video")) return "video";
    if (normalized.includes("image")) return "image";
    return "any";
  }, [accept, pickerKind]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(value || "");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, value]);

  const resetSelection = (nextPreview: string | undefined) => {
    setFile(null);
    setPreviewUrl(nextPreview ?? "");
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    setError(null);
    const next = event.target.files?.[0] ?? null;
    if (!next) {
      resetSelection(value || "");
      return;
    }
    setFile(next);
  };

  const handleUpload = async () => {
    if (disabled) return;
    if (!file) {
      setError("Select a file before uploading.");
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append("file", file);

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
      } else {
        throw new Error("Upload response missing url");
      }
    } catch (err: unknown) {
      console.error("Upload error", err);
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message || "Upload failed");
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

  const isImage = file
    ? file.type.startsWith("image/")
    : !!previewUrl && /\.(png|jpe?g|gif|webp|svg)$/i.test(previewUrl);

  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/80 p-4 text-neutral-100 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{label}</p>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className={`text-xs font-semibold transition ${
              disabled ? "cursor-not-allowed text-red-400/60" : "text-red-300 hover:text-red-200"
            }`}
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-2">
        <input
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="block w-full text-sm text-neutral-200 file:mr-2 file:rounded-md file:border-0 file:bg-yellow-400 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black"
          disabled={disabled}
        />

        {allowLibrary ? (
          <button
            type="button"
            onClick={() => setShowLibrary(true)}
            disabled={disabled}
            className={`w-full rounded border px-3 py-2 text-sm font-semibold transition ${
              disabled
                ? "cursor-not-allowed border-neutral-700 text-neutral-500"
                : "border-neutral-700 text-neutral-200 hover:border-yellow-300 hover:text-yellow-200"
            }`}
          >
            Browse media library
          </button>
        ) : null}
      </div>

      {previewUrl ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
          {isImage ? (
            <img src={previewUrl} alt="Preview" className="mx-auto max-h-40 object-contain" />
          ) : (
            <p className="break-all text-xs text-neutral-300">{previewUrl}</p>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || disabled}
          className={`rounded px-4 py-2 font-semibold transition ${
            uploading || disabled
              ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
              : "bg-yellow-400 text-black hover:bg-yellow-300"
          }`}
        >
          {uploading ? "Uploading…" : `${buttonLabel} from computer`}
        </button>
        {value && !file ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:border-yellow-300 hover:text-yellow-200"
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
