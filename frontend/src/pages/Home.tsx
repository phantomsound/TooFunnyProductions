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
    <main className="bg-theme-background text-theme-base">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-12">
        <section className="overflow-hidden rounded-3xl border border-theme-surface bg-theme-surface p-8 shadow-2xl lg:p-14">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
            <div className="flex flex-col gap-10">
              <header className="space-y-4">
                <span className="theme-accent-chip inline-flex items-center gap-2 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em]">
                  Too Funny Productions
                </span>
                <h1 className="text-3xl font-bold leading-tight text-theme-accent sm:text-4xl lg:text-[2.75rem]">
                  {heroTitle}
                </h1>
                <p className="max-w-xl text-base text-theme-muted sm:text-lg">{heroSubtext}</p>
              </header>

              <div className="flex flex-wrap gap-4">
                <Link
                  to={`/events${stageSuffix}`}
                  className="theme-accent-button rounded-full px-6 py-2.5 text-sm font-semibold transition"
                >
                  Get Tickets
                </Link>
                <Link
                  to={`/media${stageSuffix}`}
                  className="theme-accent-outline rounded-full px-6 py-2.5 text-sm font-semibold"
                >
                  Watch a Clip
                </Link>
                <Link
                  to={`/contact${stageSuffix}`}
                  className="theme-neutral-outline rounded-full px-6 py-2.5 text-sm font-semibold"
                >
                  Contact Us
                </Link>
              </div>

              {hasEvents ? (
                <div className="theme-accent-panel rounded-3xl p-6 shadow-inner">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.4em] text-theme-accent-soft">Next up</p>
                      <h2 className="text-lg font-semibold text-theme-accent">{upcoming[0]?.title || "Live show"}</h2>
                      <p className="text-sm text-theme-base">
                        {(upcoming[0]?.date || "Date TBA") + " • " + (upcoming[0]?.venue || "Venue TBA")}
                      </p>
                    </div>
                    <Link
                      to={`/events${stageSuffix}`}
                      className="theme-accent-outline inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em]"
                    >
                      View All
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-6">
              <div className="relative overflow-hidden rounded-3xl border border-theme-surface bg-theme-surface p-4 shadow-2xl">
                <div className="pointer-events-none absolute left-6 top-6 inline-flex items-center gap-2 theme-accent-chip px-4 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.4em]">
                  Featured Video
                </div>
                <div className="aspect-video overflow-hidden rounded-2xl border border-theme-surface bg-theme-background">
                  {heroVideo ? (
                    <video src={heroVideo} controls preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-theme-muted">
                      Add a featured video in the admin panel to showcase your latest work.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-theme-surface bg-theme-surface p-4 shadow-xl">
                <div className="aspect-[3/2] overflow-hidden rounded-2xl border border-theme-surface bg-theme-background">
                  {heroImage ? (
                    <img
                      src={heroImage}
                      alt={heroTitle || "Too Funny Productions hero"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[3/2] items-center justify-center px-4 text-center text-xs text-theme-muted">
                      Add a hero image in the admin panel to complete the look.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
          <div className="rounded-3xl border border-theme-surface bg-theme-surface p-8 shadow-lg">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.4em] text-theme-accent-soft">Who We Are</p>
                <h2 className="text-2xl font-semibold text-theme-accent">{whoTitle}</h2>
              </div>
              <p className="leading-relaxed text-theme-muted">{whoBody}</p>
              <div className="flex flex-wrap gap-3">
                {whoCtaUrl
                  ? whoIsExternal
                    ? (
                        <a
                          href={whoCtaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="theme-accent-button rounded-full px-4 py-2 text-sm font-semibold transition"
                        >
                          {whoCtaLabel}
                        </a>
                      )
                    : (
                        <Link
                          to={`${whoCtaUrl}${stageSuffix}`}
                          className="theme-accent-button rounded-full px-4 py-2 text-sm font-semibold transition"
                        >
                          {whoCtaLabel}
                        </Link>
                      )
                  : null}
                <Link
                  to={`/contact${stageSuffix}`}
                  className="theme-neutral-outline rounded-full px-4 py-2 text-sm font-semibold"
                >
                  Book the Crew
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-lg">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-theme-accent">Upcoming Shows</h2>
                  <p className="text-sm text-theme-muted">Fresh chaos, fresh cities—see where we’re headed.</p>
                </div>
                <Link
                  to={`/events${stageSuffix}`}
                  className="theme-neutral-outline rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em]"
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
                        className="flex flex-col gap-2 rounded-2xl border border-theme-surface bg-theme-background p-4 transition hover:border-theme-accent"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-xs uppercase tracking-[0.4em] text-theme-muted">
                            {event?.date || "Date TBA"}
                          </p>
                          <span className="text-xs text-theme-muted">{event?.venue || "Venue TBA"}</span>
                        </div>
                        <h3 className="text-lg font-semibold text-theme-accent">{event?.title || "Untitled Show"}</h3>
                        {hasLink ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold text-theme-accent hover:text-theme-accent"
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
                <p className="mt-4 text-sm text-theme-muted">
                  No shows are on the calendar yet—check back soon or follow us on social for updates.
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-lg">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-theme-accent">Media Spotlight</h2>
                  <p className="text-sm text-theme-muted">
                    Dive into sketches, behind-the-scenes clips, and the latest Too Funny chaos.
                  </p>
                </div>
                <Link
                  to={`/media${stageSuffix}`}
                  className="theme-accent-button inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition whitespace-nowrap"
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
