/* =========================================================================
   FILE: frontend/src/pages/Home.tsx
   -------------------------------------------------------------------------
   Public Home; shows draft if ?stage=draft by calling /api/settings/preview.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useSettings } from "../lib/SettingsContext";
import { api } from "../lib/api";

type SizeOption = "small" | "medium" | "large";

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
  hero_title_size?: SizeOption;
  hero_subtext_size?: SizeOption;
  hero_badge_size?: SizeOption;
};

const resolveSize = (value: unknown): SizeOption => {
  if (value === "small" || value === "medium" || value === "large") return value;
  return "medium";
};

const HERO_TITLE_CLASSES: Record<SizeOption, string> = {
  small: "text-[1.75rem] sm:text-[2rem] lg:text-[2.25rem]",
  medium: "text-3xl sm:text-4xl lg:text-[2.85rem]",
  large: "text-4xl sm:text-5xl lg:text-[3.35rem]",
};

const HERO_SUBTEXT_CLASSES: Record<SizeOption, string> = {
  small: "text-sm sm:text-[0.95rem] lg:text-base",
  medium: "text-base sm:text-lg",
  large: "text-lg sm:text-xl",
};

const HERO_BADGE_CLASSES: Record<SizeOption, string> = {
  small: "px-3 py-1 text-[0.55rem] tracking-[0.28em]",
  medium: "px-4 py-1 text-[0.65rem] tracking-[0.3em]",
  large: "px-5 py-1 text-[0.75rem] tracking-[0.32em]",
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
  const heroTitleSize = resolveSize(settings?.hero_title_size);
  const heroSubtextSize = resolveSize(settings?.hero_subtext_size);
  const heroBadgeSize = resolveSize(settings?.hero_badge_size);
  const heroTitleClass = HERO_TITLE_CLASSES[heroTitleSize];
  const heroSubtextClass = HERO_SUBTEXT_CLASSES[heroSubtextSize];
  const heroBadgeClass = HERO_BADGE_CLASSES[heroBadgeSize];
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
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:max-w-7xl lg:px-8 xl:px-10">
        <section className="overflow-hidden rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-2xl sm:rounded-[2.25rem] sm:p-8 lg:p-14">
          <div className="grid gap-9 sm:gap-11 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:items-start lg:gap-12">
            <div className="flex min-w-0 flex-col gap-10">
              <header className="space-y-4">
                <span
                  className={`theme-accent-chip inline-flex items-center gap-2 font-semibold uppercase ${heroBadgeClass}`}
                >
                  Too Funny Productions
                </span>
                <h1 className={`font-bold leading-tight text-theme-accent ${heroTitleClass}`}>
                  {heroTitle}
                </h1>
                <p className={`max-w-xl break-words text-theme-muted ${heroSubtextClass}`}>{heroSubtext}</p>
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
                <div className="theme-accent-panel rounded-3xl p-5 shadow-inner sm:p-6">
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

            <div className="grid min-w-0 gap-5 sm:gap-7">
              <div className="w-full rounded-3xl border border-theme-surface bg-theme-surface p-4 shadow-[0_35px_60px_-15px_rgba(0,0,0,0.45)] sm:p-5 lg:p-8">
                <div className="relative aspect-[3/2] min-h-[240px] w-full min-w-0 overflow-hidden rounded-2xl border border-theme-surface bg-theme-background sm:min-h-[280px] lg:min-h-[360px]">
                  {heroImage ? (
                    <img
                      src={heroImage}
                      alt={heroTitle || "Too Funny Productions hero"}
                      className="h-full w-full max-w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-theme-muted">
                      Add a hero image in the admin panel to complete the look.
                    </div>
                  )}
                </div>
              </div>

              <div className="relative w-full overflow-hidden rounded-3xl border border-theme-surface bg-theme-surface p-4 shadow-xl sm:p-5 lg:p-6">
                <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-[0.4em] text-theme-accent-soft">
                  Featured Video
                </p>
                <div className="aspect-video w-full min-w-0 overflow-hidden rounded-2xl border border-theme-surface bg-theme-background">
                  {heroVideo ? (
                    <video src={heroVideo} controls preload="metadata" className="h-full w-full max-w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-theme-muted">
                      Add a featured video in the admin panel to showcase your latest work.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-8 sm:mt-[4.5rem] sm:gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
          <div className="min-w-0 w-full rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-lg sm:p-7 md:p-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.4em] text-theme-accent-soft">Who We Are</p>
                <h2 className="text-2xl font-semibold text-theme-accent">{whoTitle}</h2>
              </div>
              <p className="break-words leading-relaxed text-theme-muted">{whoBody}</p>
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

          <div className="min-w-0 w-full space-y-5 sm:space-y-6">
            <section className="w-full rounded-3xl border border-theme-surface bg-theme-surface p-5 shadow-lg sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between">
                          <p className="text-xs uppercase tracking-[0.4em] text-theme-muted">
                            {event?.date || "Date TBA"}
                          </p>
                          <span className="text-xs text-theme-muted sm:text-right">{event?.venue || "Venue TBA"}</span>
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

            <section className="w-full rounded-3xl border border-theme-surface bg-theme-surface p-5 shadow-lg sm:p-6">
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
