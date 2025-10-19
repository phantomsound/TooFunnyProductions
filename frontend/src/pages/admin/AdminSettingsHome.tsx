/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsHome.tsx
   -------------------------------------------------------------------------
   Home page fields wired to SettingsContext.
   ========================================================================= */
import React from "react";
import { useSettings } from "../../lib/SettingsContext";

export default function AdminSettingsHome() {
  const { settings, setField, save, stage } = useSettings();
  const s = settings || {};

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Home Page Settings</h3>

      <label className="block text-sm font-medium mb-1">Hero Title</label>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        value={s.hero_title || ""}
        onChange={(e) => setField("hero_title", e.target.value)}
        placeholder="Comedy that's Too Funny"
      />

      <label className="block text-sm font-medium mb-1">Hero Subtext</label>
      <textarea
        className="w-full border rounded px-3 py-2 mb-4"
        rows={3}
        value={s.hero_subtext || ""}
        onChange={(e) => setField("hero_subtext", e.target.value)}
        placeholder="Original sketch, live shows, and shamelessly fun chaos."
      />

      <label className="block text-sm font-medium mb-1">Hero Image URL</label>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        value={s.hero_image_url || ""}
        onChange={(e) => setField("hero_image_url", e.target.value)}
        placeholder="https://…/hero.jpg"
      />

      <label className="block text-sm font-medium mb-1">Featured Video URL (mp4/webm or embed)</label>
      <input
        className="w-full border rounded px-3 py-2 mb-6"
        value={s.featured_video_url || ""}
        onChange={(e) => setField("featured_video_url", e.target.value)}
        placeholder="https://…/video.mp4"
      />

      <button
        onClick={save}
        disabled={stage !== "draft"}
        className={`px-4 py-2 rounded ${
          stage !== "draft" ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-yellow-400 text-black hover:bg-yellow-300"
        }`}
      >
        Save Changes
      </button>
    </div>
  );
}
