import React, { useMemo } from "react";
import { useSettings } from "../lib/SettingsContext";

const isArchiveTitle = (value: unknown): boolean =>
  typeof value === "string" && value.trim().toLowerCase() === "archive";

export default function Media() {
  const { settings } = useSettings();
  const sections = Array.isArray(settings?.media_sections) ? settings.media_sections : [];
  // section: { title: string, items: [{type:"video"|"image", url, title?}] }
  const title = typeof settings?.media_title === "string" ? settings.media_title : "Media";
  const intro =
    typeof settings?.media_intro === "string"
      ? settings.media_intro
      : "Watch our latest sketches, clips, and behind-the-scenes footage.";

  const visibleSections = useMemo(
    () => sections.filter((section: any) => section && !isArchiveTitle(section.title)),
    [sections]
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 text-theme-base sm:px-6 sm:py-12 lg:px-8">
      <h1 className="mb-3 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-8 whitespace-pre-wrap break-words text-theme-muted">{intro}</p>

      {visibleSections.map((s: any, idx: number) => (
        <div key={idx} className="mb-10">
          <h2 className="mb-4 text-2xl font-semibold text-theme-accent">{s.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(s.items || []).map((it: any, i: number) => (
              <div key={i} className="rounded border border-theme-surface bg-theme-surface p-3">
                {it.type === "video" ? (
                  <div className="aspect-video mb-2 w-full overflow-hidden rounded">
                    <video src={it.url} controls preload="metadata" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <img src={it.url} alt={it.title || ""} className="mb-2 h-48 w-full rounded object-cover" />
                )}
                {it.title && <div className="break-words text-sm text-theme-muted">{it.title}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {visibleSections.length === 0 && <div className="text-theme-muted">No media yet.</div>}
    </div>
  );
}
