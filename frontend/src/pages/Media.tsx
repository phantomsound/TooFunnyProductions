import React from "react";
import { useSettings } from "../lib/SettingsContext";

export default function Media() {
  const { settings } = useSettings();
  const sections = Array.isArray(settings?.media_sections) ? settings.media_sections : [];
  // section: { title: string, items: [{type:"video"|"image", url, title?}] }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-6">{settings?.media_title || "Media"}</h1>

      {sections.map((s: any, idx: number) => (
        <div key={idx} className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">{s.title}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(s.items || []).map((it: any, i: number) => (
              <div key={i} className="bg-[#111] rounded p-3">
                {it.type === "video" ? (
                  <div className="aspect-video w-full overflow-hidden rounded mb-2">
                    <video src={it.url} controls preload="metadata" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <img src={it.url} alt={it.title || ""} className="w-full h-48 object-cover rounded mb-2" />
                )}
                {it.title && <div className="text-sm opacity-90">{it.title}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {sections.length === 0 && <div className="opacity-70">No media yet.</div>}
    </div>
  );
}
