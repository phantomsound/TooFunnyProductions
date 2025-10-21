import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";

type SettingsUploaderProps = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  buttonLabel?: string;
  disabled?: boolean;
};

type UploadError = string | null;

export default function SettingsUploader({
  label,
  value,
  onChange,
  accept = "*",
  buttonLabel = "Upload",
  disabled = false,
}: SettingsUploaderProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<UploadError>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(value || "");

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

  const isImage = file
    ? file.type.startsWith("image/")
    : !!previewUrl && /\.(png|jpe?g|gif|webp|svg)$/i.test(previewUrl);

  return (
    <div className="border border-gray-300 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{label}</p>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className={`text-xs font-semibold ${
              disabled ? "text-red-300 cursor-not-allowed" : "text-red-600 hover:text-red-700"
            }`}
          >
            Clear
          </button>
        )}
      </div>

      <input
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="block w-full text-sm"
        disabled={disabled}
      />

      {previewUrl ? (
        <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
          {isImage ? (
            <img src={previewUrl} alt="Preview" className="max-h-40 mx-auto object-contain" />
          ) : (
            <p className="text-xs text-gray-600 break-all">{previewUrl}</p>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || disabled}
          className={`px-4 py-2 font-semibold rounded ${
            uploading || disabled
              ? "bg-blue-300 text-white/80 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {uploading ? "Uploading…" : buttonLabel}
        </button>
        {value && !file ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 border border-gray-300 rounded text-sm font-semibold hover:bg-gray-50"
          >
            View current
          </a>
        ) : null}
      </div>
    </div>
  );
}
