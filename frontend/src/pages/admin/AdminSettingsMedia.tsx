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
import UploadFromComputerButton from "../../components/admin/UploadFromComputerButton";
import { normalizeAdminUrl } from "../../utils/url";

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

const isArchiveSection = (title: string): boolean => title.trim().toLowerCase() === "archive";

const arrangeSections = (sections: MediaSection[]): MediaSection[] => {
  if (sections.length <= 1) return sections;
  const archive: MediaSection[] = [];
  const regular: MediaSection[] = [];
  sections.forEach((section) => {
    if (isArchiveSection(section.title)) {
      archive.push(section);
    } else {
      regular.push(section);
    }
  });
  return [...regular, ...archive];
};

const sanitizeSections = (value: unknown): MediaSection[] => {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title : "",
        items: sanitizeItems(obj.items),
      };
    });
  return arrangeSections(cleaned);
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

type MoveDialogState = {
  request: { sectionIndex: number; itemIndex: number };
  target: string;
  newTitle: string;
};

export default function AdminSettingsMedia(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<MediaSettings>(safe);
  const [picker, setPicker] = useState<PickerState>(null);
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof MediaSettings>(key: K, value: MediaSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const applySections = (updater: (sections: MediaSection[]) => MediaSection[]) => {
    setLocal((prev) => {
      const nextSections = arrangeSections(updater(prev.media_sections));
      setField("media_sections", nextSections);
      return { ...prev, media_sections: nextSections };
    });
  };

  const updateSectionTitle = (index: number, title: string) => {
    if (disabled) return;
    applySections((sections) =>
      sections.map((section, idx) => (idx === index ? { ...section, title } : section))
    );
  };

  const addSection = () => {
    if (disabled) return;
    applySections((sections) => [
      ...sections,
      { ...blankSection, items: [{ ...blankItem }] },
    ]);
  };

  const removeSection = (index: number) => {
    if (disabled) return;
    applySections((sections) => sections.filter((_, idx) => idx !== index));
  };

  const addItem = (sectionIndex: number) => {
    if (disabled) return;
    applySections((sections) =>
      sections.map((section, idx) =>
        idx === sectionIndex ? { ...section, items: [...section.items, { ...blankItem }] } : section
      )
    );
  };

  const removeItem = (sectionIndex: number, itemIndex: number) => {
    if (disabled) return;
    applySections((sections) =>
      sections.map((section, idx) => {
        if (idx !== sectionIndex) return section;
        const nextItems = section.items.filter((_, i) => i !== itemIndex);
        return { ...section, items: nextItems.length > 0 ? nextItems : [{ ...blankItem }] };
      })
    );
  };

  const updateItem = (
    sectionIndex: number,
    itemIndex: number,
    patch: Partial<MediaItem>
  ) => {
    if (disabled) return;
    applySections((sections) =>
      sections.map((section, idx) => {
        if (idx !== sectionIndex) return section;
        const nextItems = section.items.map((item, i) => {
          if (i !== itemIndex) return item;
          const next: MediaItem = { ...item, ...patch };
          if (typeof patch.url === "string") {
            next.url = normalizeAdminUrl(patch.url);
          }
          return next;
        });
        return { ...section, items: nextItems };
      })
    );
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    if (disabled) return;
    applySections((sections) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= sections.length) return sections;
      const next = [...sections];
      const [entry] = next.splice(index, 1);
      next.splice(targetIndex, 0, entry);
      return next;
    });
  };

  const openMoveDialog = (sectionIndex: number, itemIndex: number) => {
    if (disabled) return;
    const availableTargets = local.media_sections
      .map((_, idx) => idx)
      .filter((idx) => idx !== sectionIndex);
    const defaultTarget = availableTargets.length > 0 ? String(availableTargets[0]) : "__create__";
    setMoveDialog({
      request: { sectionIndex, itemIndex },
      target: defaultTarget,
      newTitle: "New Section",
    });
  };

  const cancelMoveDialog = () => setMoveDialog(null);

  const confirmMoveDialog = () => {
    if (!moveDialog || disabled) return;
    const { sectionIndex, itemIndex } = moveDialog.request;
    applySections((sections) => {
      const sourceSection = sections[sectionIndex];
      if (!sourceSection) return sections;
      const moving = sourceSection.items[itemIndex];
      if (!moving) return sections;
      const itemToMove: MediaItem = { ...moving };
      const nextSections = sections.map((section, idx) => {
        if (idx !== sectionIndex) return section;
        const remaining = section.items.filter((_, i) => i !== itemIndex);
        const safeRemaining = remaining.length > 0 ? remaining : [{ ...blankItem }];
        return { ...section, items: safeRemaining };
      });

      if (moveDialog.target === "__create__") {
        const title = moveDialog.newTitle.trim() || "New Section";
        return [...nextSections, { title, items: [itemToMove] }];
      }

      const destinationIndex = Number(moveDialog.target);
      if (!Number.isFinite(destinationIndex) || !nextSections[destinationIndex]) {
        return sections;
      }

      return nextSections.map((section, idx) =>
        idx === destinationIndex ? { ...section, items: [...section.items, itemToMove] } : section
      );
    });
    setMoveDialog(null);
  };

  const setMoveDialogTarget = (target: string) => {
    setMoveDialog((prev) => (prev ? { ...prev, target } : prev));
  };

  const setMoveDialogTitle = (title: string) => {
    setMoveDialog((prev) => (prev ? { ...prev, newTitle: title } : prev));
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
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Media sections</h3>
          <p className="text-sm text-gray-600">
            Reorder sections with the move buttons. Any section named <strong>Archive</strong> is hidden on the public page
            and automatically pinned to the bottom of the list.
          </p>
        </div>
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
          {local.media_sections.map((section, sectionIndex) => {
            const archive = isArchiveSection(section.title);
            const canMoveUp = sectionIndex > 0 && !archive;
            const canMoveDown = sectionIndex < local.media_sections.length - 1;
            return (
              <div key={sectionIndex} className="space-y-4 rounded border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-3">
                    <input
                      className="w-full rounded border border-gray-300 px-3 py-2 text-black md:max-w-sm"
                      value={section.title}
                      onChange={(event) => updateSectionTitle(sectionIndex, event.target.value)}
                      disabled={disabled}
                      placeholder="Section title"
                    />
                    {archive ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                        Hidden on public site
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveSection(sectionIndex, -1)}
                        disabled={disabled || !canMoveUp}
                        className={`rounded border px-2 py-1 text-xs font-semibold ${
                          disabled || !canMoveUp
                            ? "cursor-not-allowed border-gray-200 text-gray-400"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(sectionIndex, 1)}
                        disabled={disabled || !canMoveDown}
                        className={`rounded border px-2 py-1 text-xs font-semibold ${
                          disabled || !canMoveDown
                            ? "cursor-not-allowed border-gray-200 text-gray-400"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        Move down
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSection(sectionIndex)}
                      disabled={disabled}
                      className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove section
                    </button>
                  </div>
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

                    <div className="mt-3 flex flex-wrap items-start gap-2">
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
                      <UploadFromComputerButton
                        onUploaded={(url) => updateItem(sectionIndex, itemIndex, { url })}
                        accept={item.type === "image" ? "image/*" : item.type === "video" ? "video/*" : "*"}
                        disabled={disabled}
                      />
                      <button
                        type="button"
                        onClick={() => openMoveDialog(sectionIndex, itemIndex)}
                        disabled={disabled || local.media_sections.length === 0}
                        className={`rounded border px-3 py-2 text-sm font-semibold ${
                          disabled
                            ? "cursor-not-allowed border-gray-200 text-gray-400"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        Move to other section
                      </button>
                      <button
                        type="button"
                        onClick={() => updateItem(sectionIndex, itemIndex, { url: "" })}
                        disabled={disabled || !item.url}
                        className={`rounded border px-3 py-2 text-sm font-semibold ${
                          disabled || !item.url
                            ? "cursor-not-allowed border-gray-200 text-gray-400"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        Clear media
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
            );
          })}
        </div>
      )}

      {moveDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h4 className="text-lg font-semibold text-gray-900">Move media item</h4>
            <p className="mt-2 text-sm text-gray-600">
              Choose an existing section or create a new one. New sections are added to the end of the list.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-gray-700">
                Destination section
                <select
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  value={moveDialog.target}
                  onChange={(event) => setMoveDialogTarget(event.target.value)}
                >
                  {local.media_sections.map((section, idx) =>
                    idx === moveDialog.request.sectionIndex ? null : (
                      <option key={idx} value={String(idx)}>
                        {section.title?.trim() || `Section ${idx + 1}`}
                      </option>
                    )
                  )}
                  <option value="__create__">Create new section…</option>
                </select>
              </label>

              {moveDialog.target === "__create__" ? (
                <label className="block text-sm font-semibold text-gray-700">
                  New section name
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    value={moveDialog.newTitle}
                    onChange={(event) => setMoveDialogTitle(event.target.value)}
                    placeholder="Archive"
                  />
                </label>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelMoveDialog}
                className="rounded border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMoveDialog}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Move item
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <MediaPickerModal
        isOpen={picker !== null && !disabled}
        onClose={() => setPicker(null)}
        onSelect={handlePick}
        kind={picker?.kind ?? "any"}
      />
    </div>
  );
}

