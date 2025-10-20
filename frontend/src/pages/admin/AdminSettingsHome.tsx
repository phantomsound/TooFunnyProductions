/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsHome.tsx
   -------------------------------------------------------------------------
   Home page fields wired to SettingsContext.
   ========================================================================= */
import React from "react";
import { useSettings } from "../../lib/SettingsContext";

export default function AdminSettingsHome() {
  const { settings, setField, stage } = useSettings();
  const s = settings || {};
  const disabled = stage !== "draft";

  const update = (key: string, value: unknown) => {
    if (disabled) return;
    setField(key, value);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Home Page Settings</h3>

      {disabled ? (
        <p className="mb-4 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
          Switch to the Draft view to edit the home page content.
        </p>
      ) : null}

      <label className="block text-sm font-medium mb-1">Hero Title</label>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        value={s.hero_title || ""}
        onChange={(e) => update("hero_title", e.target.value)}
        disabled={disabled}
        placeholder="Comedy that's Too Funny"
      />

      <label className="block text-sm font-medium mb-1">Hero Subtext</label>
      <textarea
        className="w-full border rounded px-3 py-2 mb-4"
        rows={3}
        value={s.hero_subtext || ""}
        onChange={(e) => update("hero_subtext", e.target.value)}
        disabled={disabled}
        placeholder="Original sketch, live shows, and shamelessly fun chaos."
      />

      <label className="block text-sm font-medium mb-1">Hero Image URL</label>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        value={s.hero_image_url || ""}
        onChange={(e) => update("hero_image_url", e.target.value)}
        disabled={disabled}
        placeholder="https://…/hero.jpg"
      />

      <label className="block text-sm font-medium mb-1">Featured Video URL (mp4/webm or embed)</label>
      <input
        className="w-full border rounded px-3 py-2 mb-6"
        value={s.featured_video_url || ""}
        onChange={(e) => update("featured_video_url", e.target.value)}
        disabled={disabled}
        placeholder="https://…/video.mp4"
      />
    </div>
  );
}
