import React from "react";

import { uploadMedia } from "../../lib/uploadMedia";

interface UploadFromComputerButtonProps {
  onUploaded: (url: string) => void;
  accept?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export default function UploadFromComputerButton({
  onUploaded,
  accept = "*",
  disabled = false,
  children = "Upload from computer",
  className = "",
}: UploadFromComputerButtonProps): JSX.Element {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = () => {
    if (disabled || uploading) return;
    setError(null);
    inputRef.current?.click();
  };

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || uploading) return;
    const file = event.target.files?.[0];
    if (!file) {
      event.target.value = "";
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const url = await uploadMedia(file);
      onUploaded(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="flex min-w-[170px] flex-col gap-1 text-sm">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || uploading}
        className={`rounded border px-3 py-2 font-semibold transition ${
          disabled || uploading
            ? "cursor-not-allowed border-gray-200 text-gray-400"
            : "border-gray-300 bg-white hover:bg-gray-100"
        } ${className}`.trim()}
      >
        {uploading ? "Uploading…" : children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        disabled={disabled || uploading}
      />
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}
