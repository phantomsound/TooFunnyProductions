// frontend/src/components/SettingsUploader.tsx
import React, { useState } from "react";
import axios from "axios";

interface Props {
  label: string;
  onUploadComplete: (url: string) => void;
}

const SettingsUploader: React.FC<Props> = ({ label, onUploadComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
    }
  };

  const handleUpload = async () => {
    if (!file) return alert("Please choose a file first.");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post("http://localhost:5000/api/storage/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const fileUrl = res.data.url;
      onUploadComplete(fileUrl);
      alert("✅ Upload complete!");
    } catch (err) {
      console.error("Upload failed:", err);
      alert("❌ Upload failed — check backend logs.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-2 border-dashed border-gray-400 rounded-lg p-6 text-center bg-gray-50 mb-4">
      <p className="font-semibold mb-2">{label}</p>
      <input
        type="file"
        onChange={handleFileChange}
        className="block w-full text-center mb-4"
      />

      {previewUrl && (
        <div className="mb-3">
          {file?.type.startsWith("image/") ? (
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-48 mx-auto rounded shadow"
            />
          ) : (
            <p className="text-sm text-gray-500 italic">Preview unavailable</p>
          )}
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className={`px-4 py-2 rounded text-white font-semibold ${
          uploading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {uploading ? "Uploading..." : "Upload File"}
      </button>
    </div>
  );
};

export default SettingsUploader;
