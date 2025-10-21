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

  const heroTitle = settings?.hero_title || "Comedy that’s Too Funny";
  const heroSubtext =
    settings?.hero_subtext || "Original sketch, live shows, and shamelessly fun chaos.";
  const heroImage = settings?.hero_image_url || "";
  const heroVideo = settings?.featured_video_url || "";

  return (
    <div className="text-white">
      <section className="px-4 py-10 mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-6">
            <header>
              <h1 className="text-3xl font-bold text-yellow-400 mb-2">{heroTitle}</h1>
              <p className="opacity-80">{heroSubtext}</p>
            </header>

            {heroVideo ? (
              <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40 shadow">
                <video
                  src={heroVideo}
                  controls
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="rounded border border-dashed border-white/20 p-6 text-sm text-white/60">
                Add a featured video in the admin panel to showcase your latest work.
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Link
                to={`/events${stageSuffix}`}
                className="px-4 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
              >
                See Shows
              </Link>
              <Link
                to={`/media${stageSuffix}`}
                className="px-4 py-2 rounded border border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black"
              >
                Watch a Clip
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {heroImage ? (
              <img
                src={heroImage}
                alt="Hero"
                className="w-full rounded-2xl border border-white/10 object-cover shadow-lg"
              />
            ) : (
              <div className="rounded border border-dashed border-white/20 p-6 text-sm text-white/60">
                Add a hero image in the admin panel to complete the layout.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
