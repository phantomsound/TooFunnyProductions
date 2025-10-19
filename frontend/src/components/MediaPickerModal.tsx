import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { X } from "lucide-react";

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

const MediaPickerModal: React.FC<MediaPickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const [files, setFiles] = useState<{ name: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) fetchFiles();
  }, [isOpen]);

  const fetchFiles = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from("media").list("uploads", { limit: 100 });
    if (error) {
      console.error("Error loading media:", error);
      setLoading(false);
      return;
    }

    const urls = data.map((f) => ({
      name: f.name,
      url: supabase.storage.from("media").getPublicUrl(`uploads/${f.name}`).data.publicUrl,
    }));

    setFiles(urls);
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg w-[90%] max-w-4xl p-6 shadow-lg relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-black"
        >
          <X size={20} />
        </button>

        <h3 className="text-xl font-bold mb-4 text-center">Select Media</h3>

        {loading ? (
          <p className="text-center text-gray-500">Loading...</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {files.map((file) => (
              <div
                key={file.url}
                className="border rounded-lg overflow-hidden hover:ring-2 hover:ring-yellow-400 cursor-pointer"
                onClick={() => {
                  onSelect(file.url);
                  onClose();
                }}
              >
                {file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                  <img
                    src={file.url}
                    alt={file.name}
                    className="object-cover w-full h-32"
                  />
                ) : (
                  <video
                    src={file.url}
                    className="object-cover w-full h-32"
                  ></video>
                )}
                <p className="text-sm text-center mt-1 truncate px-1">{file.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaPickerModal;
