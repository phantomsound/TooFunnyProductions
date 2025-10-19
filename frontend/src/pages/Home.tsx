/* =========================================================================
   FILE: frontend/src/pages/Home.tsx
   -------------------------------------------------------------------------
   Public Home; shows draft if ?stage=draft by calling /api/settings/preview.
   ========================================================================= */
import React, { useEffect, useState } from "react";
import { useSettings } from "../lib/SettingsContext";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";

type Settings = {
  hero_title?: string;
  hero_subtext?: string;
  hero_image_url?: string;
  featured_video_url?: string;
};

export default function Home() {
  const { settings: liveSettings } = useSettings();
  const { search } = useLocation();
  const isDraftPreview = new URLSearchParams(search).get("stage") === "draft";

  const [draft, setDraft] = useState<Settings | null>(null);
  const settings: Settings = isDraftPreview ? (draft || {}) : ((liveSettings as Settings) || {});

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!isDraftPreview) {
        setDraft(null);
        return;
      }
      try {
        const r = await fetch(api("/api/settings/preview"), { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (!cancel) setDraft(d || {});
      } catch {
        if (!cancel) setDraft({});
      }
    })();
    return () => { cancel = true; };
  }, [isDraftPreview]);

  const stageSuffix = isDraftPreview ? "?stage=draft" : "";

  return (
    <div className="text-white">
      <section className="px-4 py-10 mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold text-yellow-400 mb-2">
          {settings?.hero_title || "Comedy that’s Too Funny"}
        </h1>
        <p className="opacity-80 mb-6">
          {settings?.hero_subtext || "Original sketch, live shows, and shamelessly fun chaos."}
        </p>

        {settings?.hero_image_url && (
          <img src={settings.hero_image_url} alt="Hero" className="w-full max-w-3xl rounded shadow mx-auto mb-8 object-cover" />
        )}

        {settings?.featured_video_url && (
          <div className="aspect-video w-full max-w-3xl mx-auto overflow-hidden rounded-lg mb-10">
            <video src={settings.featured_video_url} controls preload="metadata" className="h-full w-full object-cover" />
          </div>
        )}

        <div className="flex gap-3">
          <Link to={`/events${stageSuffix}`} className="px-4 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300">
            See Shows
          </Link>
          <Link to={`/media${stageSuffix}`} className="px-4 py-2 rounded border border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">
            Watch a Clip
          </Link>
        </div>
      </section>
    </div>
  );
}
