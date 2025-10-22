/* =========================================================================
   FILE: frontend/src/pages/Home.tsx
   -------------------------------------------------------------------------
   Public Home; shows draft if ?stage=draft by calling /api/settings/preview.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";
import { useSettings } from "../lib/SettingsContext";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";

type Settings = {
  hero_title?: string;
  hero_subtext?: string;
  hero_image_url?: string;
  featured_video_url?: string;
  who_title?: string;
  who_body?: string;
  who_cta_label?: string;
  who_cta_url?: string;
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
  const whoImage = settings?.who_image_url || "";
  const heroVideo = settings?.featured_video_url || "";
  const whoTitle = settings?.who_title || "Who We Are";
  const whoBody = settings?.who_body ||
    "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.";
  const whoCtaLabel = settings?.who_cta_label || "Meet the Team";
  const whoCtaUrl = settings?.who_cta_url || "/about";
  const whoIsExternal = /^https?:/i.test(whoCtaUrl);

  const upcoming = useMemo(() => {
    if (!settings || !Array.isArray((settings as any).events_upcoming)) return [] as any[];
    return ((settings as any).events_upcoming as any[]).filter(Boolean).slice(0, 3);
  }, [settings]);
  const hasEvents = upcoming.length > 0;

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
              <Link
                to={`/contact${stageSuffix}`}
                className="px-4 py-2 rounded border border-white/20 text-white/80 hover:text-white hover:border-white"
              >
                Contact Us
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

      <section className="px-4 pb-12 mx-auto max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur">
            <h2 className="text-2xl font-semibold text-yellow-300 mb-3">{whoTitle}</h2>
            <p className="opacity-90 leading-relaxed mb-4">{whoBody}</p>
            <div className="flex flex-wrap gap-3">
              {whoCtaUrl ? (
                whoIsExternal ? (
                  <a
                    href={whoCtaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
                  >
                    {whoCtaLabel}
                  </a>
                ) : (
                  <Link
                    to={`${whoCtaUrl}${stageSuffix}`}
                    className="px-4 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
                  >
                    {whoCtaLabel}
                  </Link>
                )
              ) : null}
              <Link
                to={`/media${stageSuffix}`}
                className="px-4 py-2 rounded border border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black"
              >
                Watch Latest Clips
              </Link>
              <Link
                to={`/contact${stageSuffix}`}
                className="px-4 py-2 rounded border border-white/20 text-white/80 hover:text-white hover:border-white"
              >
                Get in Touch
              </Link>
            </div>
          </div>

          <div className="space-y-4">
            {whoImage ? (
              <img
                src={whoImage}
                alt="Too Funny Productions"
                className="w-full rounded-2xl border border-white/10 object-cover shadow-lg"
              />
            ) : (
              <div className="rounded border border-dashed border-white/20 p-6 text-sm text-white/60">
                Drop a behind-the-scenes photo in the admin panel to showcase your crew.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="px-4 pb-14 mx-auto max-w-6xl">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-2xl font-semibold text-yellow-300">Upcoming Shows</h2>
              <p className="opacity-80 text-sm">
                Catch Too Funny Productions live—here’s what’s coming up next.
              </p>
            </div>
            <Link
              to={`/events${stageSuffix}`}
              className="self-start md:self-center px-4 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
            >
              View all events
            </Link>
          </div>

          {hasEvents ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((event: any, index: number) => {
                const link = typeof event?.link === "string" ? event.link : "";
                const hasLink = /^https?:/i.test(link);
                return (
                  <div
                    key={`${event?.title || "event"}-${index}`}
                    className="rounded-xl border border-white/10 bg-black/40 p-4 flex flex-col gap-3"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{event?.date || "TBA"}</p>
                      <h3 className="text-lg font-semibold text-yellow-200">{event?.title || "Untitled show"}</h3>
                    </div>
                    <p className="text-sm opacity-80">{event?.venue || "Venue TBA"}</p>
                    {hasLink ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-yellow-300 hover:text-yellow-200"
                      >
                        Get Tickets →
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-white/60">
              No shows are on the calendar yet—check back soon or follow us on social for updates.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
