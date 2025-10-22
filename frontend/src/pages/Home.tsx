/* =========================================================================
   FILE: frontend/src/pages/Home.tsx
   -------------------------------------------------------------------------
   Public Home; shows draft if ?stage=draft by calling /api/settings/preview.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useSettings } from "../lib/SettingsContext";
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
  who_image_url?: string;
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

  const heroTitle = settings?.hero_title?.trim() || "Comedy that’s Too Funny";
  const heroSubtext =
    settings?.hero_subtext?.trim() || "Original sketch, live shows, and shamelessly fun chaos.";
  const heroImage = settings?.hero_image_url?.trim() || "";
  const whoImage = settings?.who_image_url?.trim() || "";
  const heroVideo = settings?.featured_video_url?.trim() || "";
  const whoTitle = settings?.who_title?.trim() || "Who We Are";
  const whoBody =
    settings?.who_body?.trim() ||
    "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.";
  const whoCtaLabel = settings?.who_cta_label?.trim() || "Meet the Team";
  const whoCtaUrl = settings?.who_cta_url?.trim() || "/about";
  const whoIsExternal = /^https?:/i.test(whoCtaUrl);

  const upcoming = useMemo(() => {
    if (!settings || !Array.isArray((settings as any).events_upcoming)) return [] as any[];
    return ((settings as any).events_upcoming as any[]).filter(Boolean).slice(0, 3);
  }, [settings]);
  const hasEvents = upcoming.length > 0;

  return (
    <main className="bg-[#050505] text-white">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-12">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-neutral-900/90 via-neutral-950 to-black p-8 shadow-lg lg:p-12">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
            <div className="flex flex-col gap-8">
              <header className="space-y-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-yellow-200">
                  Too Funny Productions
                </span>
                <h1 className="text-3xl font-bold leading-tight text-yellow-200 sm:text-4xl lg:text-[2.6rem]">
                  {heroTitle}
                </h1>
                <p className="max-w-xl text-base text-neutral-200/90 sm:text-lg">{heroSubtext}</p>
              </header>

              <div className="flex flex-wrap gap-3">
                <Link
                  to={`/events${stageSuffix}`}
                  className="rounded-full bg-yellow-300 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-yellow-200"
                >
                  Get Tickets
                </Link>
                <Link
                  to={`/media${stageSuffix}`}
                  className="rounded-full border border-yellow-400/70 px-5 py-2.5 text-sm font-semibold text-yellow-300 transition hover:bg-yellow-300 hover:text-black"
                >
                  Watch a Clip
                </Link>
                <Link
                  to={`/contact${stageSuffix}`}
                  className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/85 transition hover:border-white hover:text-white"
                >
                  Contact Us
                </Link>
              </div>

              {hasEvents ? (
                <div className="rounded-2xl border border-white/10 bg-black/50 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.4em] text-white/40">Next up</p>
                      <h2 className="text-lg font-semibold text-yellow-200">{upcoming[0]?.title || "Live show"}</h2>
                      <p className="text-sm text-neutral-300">
                        {(upcoming[0]?.date || "Date TBA") + " • " + (upcoming[0]?.venue || "Venue TBA")}
                      </p>
                    </div>
                    <Link
                      to={`/events${stageSuffix}`}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/70 transition hover:border-white hover:text-white"
                    >
                      View All
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-6">
              <div className="grid gap-4 rounded-2xl border border-white/10 bg-black/40 p-4 sm:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/70">
                  {heroVideo ? (
                    <video
                      src={heroVideo}
                      controls
                      preload="metadata"
                      className="h-full w-full rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-white/50">
                      Add a featured video in the admin panel to showcase your latest work.
                    </div>
                  )}
                </div>
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/70">
                  {heroImage ? (
                    <img
                      src={heroImage}
                      alt="Too Funny Productions"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-white/50">
                      Add a hero image in the admin panel to complete the layout.
                    </div>
                  )}
                </div>
              </div>

              {whoImage ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                  <img src={whoImage} alt="Crew" className="h-full w-full object-cover" />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
          <div className="rounded-3xl border border-white/10 bg-neutral-900/80 p-8 shadow-lg">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.4em] text-yellow-200/70">Who We Are</p>
                <h2 className="text-2xl font-semibold text-yellow-200">{whoTitle}</h2>
              </div>
              <p className="text-neutral-200/90 leading-relaxed">{whoBody}</p>
              <div className="flex flex-wrap gap-3">
                {whoCtaUrl ? (
                  whoIsExternal ? (
                    <a
                      href={whoCtaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-yellow-300 px-4 py-2 text-sm font-semibold text-black transition hover:bg-yellow-200"
                    >
                      {whoCtaLabel}
                    </a>
                  ) : (
                    <Link
                      to={`${whoCtaUrl}${stageSuffix}`}
                      className="rounded-full bg-yellow-300 px-4 py-2 text-sm font-semibold text-black transition hover:bg-yellow-200"
                    >
                      {whoCtaLabel}
                    </Link>
                  )
                ) : null}
                <Link
                  to={`/media${stageSuffix}`}
                  className="rounded-full border border-yellow-400/70 px-4 py-2 text-sm font-semibold text-yellow-300 transition hover:bg-yellow-300 hover:text-black"
                >
                  Media Library
                </Link>
                <Link
                  to={`/contact${stageSuffix}`}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/85 transition hover:border-white hover:text-white"
                >
                  Book the Crew
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-neutral-900/70 p-6 shadow-lg">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-yellow-200">Upcoming Shows</h2>
                  <p className="text-sm text-neutral-300">Fresh chaos, fresh cities—see where we’re headed.</p>
                </div>
                <Link
                  to={`/events${stageSuffix}`}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white hover:text-white"
                >
                  All Shows
                </Link>
              </div>

              {hasEvents ? (
                <div className="mt-4 space-y-3">
                  {upcoming.map((event: any, index: number) => {
                    const link = typeof event?.link === "string" ? event.link : "";
                    const hasLink = /^https?:/i.test(link);
                    return (
                      <article
                        key={`${event?.title || "event"}-${index}`}
                        className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-black/40 p-4 transition hover:border-yellow-200/40"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-xs uppercase tracking-[0.4em] text-white/35">
                            {event?.date || "Date TBA"}
                          </p>
                          <span className="text-xs text-neutral-400">{event?.venue || "Venue TBA"}</span>
                        </div>
                        <h3 className="text-lg font-semibold text-yellow-100">{event?.title || "Untitled Show"}</h3>
                        {hasLink ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold text-yellow-300 transition hover:text-yellow-200"
                          >
                            Get Tickets
                            <span aria-hidden>→</span>
                          </a>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-4 text-sm text-neutral-400">
                  No shows are on the calendar yet—check back soon or follow us on social for updates.
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-white/10 bg-neutral-900/70 p-6 shadow-lg">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-yellow-200">Media Spotlight</h2>
                  <p className="text-sm text-neutral-300">
                    Dive into sketches, behind-the-scenes clips, and the latest Too Funny chaos.
                  </p>
                </div>
                <Link
                  to={`/media${stageSuffix}`}
                  className="rounded-full bg-yellow-300 px-4 py-2 text-sm font-semibold text-black transition hover:bg-yellow-200"
                >
                  Visit Media Page
                </Link>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
