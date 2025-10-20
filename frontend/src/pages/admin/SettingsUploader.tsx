import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  buttonLabel?: string;
}

const SettingsUploader: React.FC<Props> = ({
  label,
  value,
  onChange,
  accept = "*",
  buttonLabel = "Upload",
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const resetSelection = (nextPreview?: string) => {
    setFile(null);
    setPreviewUrl(nextPreview ?? "");
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const next = event.target.files?.[0] || null;
    if (!next) {
      resetSelection(value || "");
      return;
    }
    setFile(next);
  };

  const handleUpload = async () => {
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

      const out = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(out?.error || "Upload failed");
      }

      if (typeof out.url === "string") {
        onChange(out.url);
        resetSelection(out.url);
      } else {
        throw new Error("Upload response missing url");
      }
    } catch (err: any) {
      console.error("Upload error", err);
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    resetSelection("");
    onChange("");
  };

  const isImage = file ? file.type.startsWith("image/") : !!previewUrl && /\.(png|jpe?g|gif|webp|svg)$/i.test(previewUrl);

  return (
    <div className="border border-gray-300 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{label}</p>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-red-600 hover:text-red-700 font-semibold"
          >
            Clear
          </button>
        )}
      </div>

      <input type="file" accept={accept} onChange={handleFileChange} className="block w-full text-sm" />

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
          disabled={uploading}
          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 disabled:opacity-60"
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

export default SettingsUploader;
