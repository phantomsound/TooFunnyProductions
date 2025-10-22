/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsMedia.tsx
   -------------------------------------------------------------------------
   Admin editor for media page sections (videos + images).
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import MediaPickerModal, {
  type MediaPickerItem,
} from "../../components/MediaPickerModal";

type MediaItem = {
  type: "image" | "video";
  title: string;
  url: string;
};

type MediaSection = {
  title: string;
  items: MediaItem[];
};

type MediaSettings = {
  media_title: string;
  media_intro: string;
  media_sections: MediaSection[];
};

const sanitizeItems = (value: unknown): MediaItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      const type = obj.type === "video" ? "video" : "image";
      return {
        type,
        title: typeof obj.title === "string" ? obj.title : "",
        url: typeof obj.url === "string" ? obj.url : "",
      };
    });
};

const sanitizeSections = (value: unknown): MediaSection[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title : "",
        items: sanitizeItems(obj.items),
      };
    });
};

const sanitize = (raw: unknown): MediaSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    media_title: typeof safe.media_title === "string" ? safe.media_title : "Media",
    media_intro:
      typeof safe.media_intro === "string"
        ? safe.media_intro
        : "Watch highlights, sketches, and behind-the-scenes moments from Too Funny Productions.",
    media_sections: sanitizeSections(safe.media_sections),
  };
};

const blankItem: MediaItem = { type: "video", title: "", url: "" };
const blankSection: MediaSection = { title: "New Section", items: [blankItem] };

type PickerState = {
  sectionIndex: number;
  itemIndex: number;
  kind: "image" | "video" | "any";
} | null;

export default function AdminSettingsMedia(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<MediaSettings>(safe);
  const [picker, setPicker] = useState<PickerState>(null);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof MediaSettings>(key: K, value: MediaSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const updateSectionTitle = (index: number, title: string) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextSections = prev.media_sections.map((section, idx) =>
        idx === index ? { ...section, title } : section
      );
      setField("media_sections", nextSections);
      return { ...prev, media_sections: nextSections };
    });
  };

  const addSection = () => {
    if (disabled) return;
    const next = [...local.media_sections, { ...blankSection, items: [{ ...blankItem }] }];
    setLocal((prev) => ({ ...prev, media_sections: next }));
    setField("media_sections", next);
  };

  const removeSection = (index: number) => {
    if (disabled) return;
    const next = local.media_sections.filter((_, idx) => idx !== index);
    setLocal((prev) => ({ ...prev, media_sections: next }));
    setField("media_sections", next);
  };

  const addItem = (sectionIndex: number) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextSections = prev.media_sections.map((section, idx) =>
        idx === sectionIndex
          ? { ...section, items: [...section.items, { ...blankItem }] }
          : section
      );
      setField("media_sections", nextSections);
      return { ...prev, media_sections: nextSections };
    });
  };

  const removeItem = (sectionIndex: number, itemIndex: number) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextSections = prev.media_sections.map((section, idx) => {
        if (idx !== sectionIndex) return section;
        const nextItems = section.items.filter((_, i) => i !== itemIndex);
        return { ...section, items: nextItems.length > 0 ? nextItems : [{ ...blankItem }] };
      });
      setField("media_sections", nextSections);
      return { ...prev, media_sections: nextSections };
    });
  };

  const updateItem = (
    sectionIndex: number,
    itemIndex: number,
    patch: Partial<MediaItem>
  ) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextSections = prev.media_sections.map((section, idx) => {
        if (idx !== sectionIndex) return section;
        const nextItems = section.items.map((item, i) =>
          i === itemIndex ? { ...item, ...patch } : item
        );
        return { ...section, items: nextItems };
      });
      setField("media_sections", nextSections);
      return { ...prev, media_sections: nextSections };
    });
  };

  const openPicker = (sectionIndex: number, itemIndex: number, kind: "image" | "video") => {
    if (disabled) return;
    setPicker({ sectionIndex, itemIndex, kind });
  };

  const handlePick = (item: MediaPickerItem) => {
    if (!picker || disabled) return;
    updateItem(picker.sectionIndex, picker.itemIndex, { url: item.url });
  };

  return (
    <div className="space-y-8">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <label className="block text-sm font-semibold mb-1">Media Page Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.media_title}
            onChange={(event) => updateField("media_title", event.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Intro Paragraph</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[100px]"
            value={local.media_intro}
            onChange={(event) => updateField("media_intro", event.target.value)}
            disabled={disabled}
          />
        </div>
      </section>

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Media sections</h3>
        <button
          type="button"
          onClick={addSection}
          disabled={disabled}
          className={`rounded px-3 py-2 text-sm font-semibold ${
            disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          Add section
        </button>
      </div>

      {local.media_sections.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
          No media sections yet. Add a section to begin curating videos and images.
        </p>
      ) : (
        <div className="space-y-6">
          {local.media_sections.map((section, sectionIndex) => (
            <div key={sectionIndex} className="space-y-4 rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <input
                  className="w-full rounded border border-gray-300 px-3 py-2 text-black md:max-w-sm"
                  value={section.title}
                  onChange={(event) => updateSectionTitle(sectionIndex, event.target.value)}
                  disabled={disabled}
                  placeholder="Section title"
                />
                <button
                  type="button"
                  onClick={() => removeSection(sectionIndex)}
                  disabled={disabled}
                  className="self-start rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove section
                </button>
              </div>

              <div className="space-y-4">
                {section.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="rounded border border-gray-200 bg-gray-50 p-4">
                    <div className="grid gap-3 md:grid-cols-5">
                      <label className="text-sm font-semibold md:col-span-1">
                        Type
                        <select
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-black"
                          value={item.type}
                          onChange={(event) => updateItem(sectionIndex, itemIndex, { type: event.target.value as MediaItem["type"] })}
                          disabled={disabled}
                        >
                          <option value="video">Video</option>
                          <option value="image">Image</option>
                        </select>
                      </label>

                      <label className="text-sm font-semibold md:col-span-2">
                        Title (optional)
                        <input
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                          value={item.title}
                          onChange={(event) => updateItem(sectionIndex, itemIndex, { title: event.target.value })}
                          disabled={disabled}
                          placeholder="Clip title"
                        />
                      </label>

                      <label className="text-sm font-semibold md:col-span-2">
                        Media URL
                        <input
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                          value={item.url}
                          onChange={(event) => updateItem(sectionIndex, itemIndex, { url: event.target.value })}
                          disabled={disabled}
                          placeholder="https://…"
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openPicker(sectionIndex, itemIndex, item.type)}
                        disabled={disabled}
                        className={`rounded border px-3 py-2 text-sm font-semibold ${
                          disabled
                            ? "cursor-not-allowed border-gray-200 text-gray-400"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        Browse media library
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(sectionIndex, itemIndex)}
                        disabled={disabled}
                        className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove item
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addItem(sectionIndex)}
                  disabled={disabled}
                  className={`rounded px-3 py-2 text-sm font-semibold ${
                    disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  Add media item
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MediaPickerModal
        isOpen={picker !== null && !disabled}
        onClose={() => setPicker(null)}
        onSelect={handlePick}
        kind={picker?.kind ?? "any"}
      />
    </div>
  );
}

