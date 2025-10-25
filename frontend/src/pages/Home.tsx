/* =========================================================================
   FILE: frontend/src/pages/Home.tsx
   -------------------------------------------------------------------------
   Public Home; shows draft if ?stage=draft by calling /api/settings/preview.
   ========================================================================= */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useSettings } from "../lib/SettingsContext";
import { api } from "../lib/api";
import { resolveMediaUrl } from "../utils/media";
import { blendColors, normalizeHex, pickTextColor } from "../lib/color";

type SizeOption = "small" | "medium" | "large";
type BadgeVariant = "soft" | "bold";

const FALLBACK_HERO_IMAGE = "/assets/home.jpg";

type Settings = {
  hero_title?: string;
  hero_subtext?: string;
  hero_image_url?: string;
  logo_url?: string;
  updated_at?: string;
  featured_video_url?: string;
  who_title?: string;
  who_body?: string;
  who_cta_label?: string;
  who_cta_url?: string;
  who_image_url?: string;
  who_label?: string;
  who_show_label?: boolean;
  who_label_size?: SizeOption;
  who_title_size?: SizeOption;
  who_body_size?: SizeOption;
  hero_title_size?: SizeOption;
  hero_subtext_size?: SizeOption;
  hero_badge_size?: SizeOption;
  hero_badge_enabled?: boolean;
  hero_badge_label?: string;
  hero_badge_variant?: BadgeVariant;
  hero_badge_use_theme_color?: boolean;
  hero_badge_color?: string;
  hero_badge_text_color?: string;
  hero_title_font_size?: string;
  hero_subtext_font_size?: string;
  hero_badge_font_size?: string;
  site_title?: string;
  theme_accent?: string;
  theme_use_global?: boolean;
  home_theme_accent?: string;
};

const toVersionParam = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return String(parsed);
};

const appendQueryParams = (input: string, params: Record<string, string | null | undefined>): string => {
  const entries = Object.entries(params).filter(([, value]) => typeof value === "string" && value);
  if (!entries.length) return input;

  const [base, hash] = input.split("#", 2);
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join("&");

  return `${base}${base.includes("?") ? "&" : "?"}${query}${hash ? `#${hash}` : ""}`;
};

const resolveSize = (value: unknown): SizeOption => {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "small" || trimmed === "medium" || trimmed === "large") {
      return trimmed as SizeOption;
    }
  }
  return "medium";
};

const resolveVariant = (value: unknown): BadgeVariant => (value === "bold" ? "bold" : "soft");

const resolveBool = (value: unknown, fallback: boolean): boolean => {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
};

const FONT_SIZE_SIMPLE = /^\d+(?:\.\d+)?(?:rem|em|px|vw|vh|ch|%)$/i;
const FONT_SIZE_FUNCTION = /^(?:clamp|min|max|calc)\(\s*[-+0-9a-z.%\s,/*()]+\)$/i;
const FONT_SIZE_VAR = /^var\(\s*--[a-z0-9_-]+(?:\s*,\s*[-+0-9a-z.%\s,/*()]+)?\s*\)$/i;

const sanitizeFontSize = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  if (FONT_SIZE_SIMPLE.test(trimmed)) return trimmed;
  if (FONT_SIZE_FUNCTION.test(trimmed)) return trimmed;
  if (FONT_SIZE_VAR.test(trimmed)) return trimmed;
  return null;
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

const WHO_LABEL_CLASSES: Record<SizeOption, string> = {
  small: "text-[0.55rem] tracking-[0.32em]",
  medium: "text-xs tracking-[0.36em]",
  large: "text-sm tracking-[0.4em]",
};

const WHO_TITLE_CLASSES: Record<SizeOption, string> = {
  small: "text-xl",
  medium: "text-2xl",
  large: "text-3xl",
};

const WHO_BODY_CLASSES: Record<SizeOption, string> = {
  small: "text-sm",
  medium: "text-base",
  large: "text-lg",
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
  const heroImageRaw = (() => {
    if (typeof settings?.hero_image_url === "string" && settings.hero_image_url.trim()) {
      return settings.hero_image_url.trim();
    }
    if (typeof settings?.logo_url === "string" && settings.logo_url.trim()) {
      return settings.logo_url.trim();
    }
    return "";
  })();
  const heroVideoRaw =
    typeof settings?.featured_video_url === "string" ? settings.featured_video_url.trim() : "";
  const heroImageVersion = useMemo(() => toVersionParam(settings?.updated_at), [settings?.updated_at]);
  const heroImageSources = useMemo(() => {
    const resolved = resolveMediaUrl(heroImageRaw);
    const applyParams = (input: string, allowAugment: boolean) =>
      appendQueryParams(input, {
        stage: allowAugment && isDraftPreview ? "draft" : null,
        v: allowAugment && heroImageVersion ? heroImageVersion : null,
      });

    const candidates: string[] = [];
    if (resolved) {
      candidates.push(applyParams(resolved, true));
    }
    if (heroImageRaw && resolved !== heroImageRaw) {
      candidates.push(applyParams(heroImageRaw, true));
    }
    candidates.push(applyParams(FALLBACK_HERO_IMAGE, false));

    const unique = Array.from(new Set(candidates.filter(Boolean)));
    return unique.length > 0 ? unique : [FALLBACK_HERO_IMAGE];
  }, [heroImageRaw, heroImageVersion, isDraftPreview]);
  const [heroImageIndex, setHeroImageIndex] = useState(0);
  const heroImage = heroImageSources[Math.min(heroImageIndex, heroImageSources.length - 1)] || FALLBACK_HERO_IMAGE;

  useEffect(() => {
    setHeroImageIndex(0);
  }, [heroImageSources]);

  const handleHeroImageError = useCallback(() => {
    setHeroImageIndex((prev) => {
      if (prev >= heroImageSources.length - 1) {
        return prev;
      }
      return prev + 1;
    });
  }, [heroImageSources.length]);
  const heroVideo = resolveMediaUrl(heroVideoRaw);
  const heroTitleSize = resolveSize(settings?.hero_title_size);
  const heroSubtextSize = resolveSize(settings?.hero_subtext_size);
  const heroBadgeSize = resolveSize(settings?.hero_badge_size);
  const heroBadgeVariant = resolveVariant(settings?.hero_badge_variant);
  const heroBadgeEnabled = resolveBool(settings?.hero_badge_enabled, false);
  const heroBadgeUseTheme = resolveBool(settings?.hero_badge_use_theme_color, true);
  const heroBadgeLabel = settings?.hero_badge_label?.trim() || "Live Comedy";
  const heroTitleClass = HERO_TITLE_CLASSES[heroTitleSize];
  const heroSubtextClass = HERO_SUBTEXT_CLASSES[heroSubtextSize];
  const heroBadgeClass = HERO_BADGE_CLASSES[heroBadgeSize];
  const heroTitleFontSize = sanitizeFontSize(settings?.hero_title_font_size);
  const heroSubtextFontSize = sanitizeFontSize(settings?.hero_subtext_font_size);
  const heroBadgeFontSize = sanitizeFontSize(settings?.hero_badge_font_size);
  const heroTitleStyle = heroTitleFontSize ? ({ fontSize: heroTitleFontSize } as React.CSSProperties) : undefined;
  const heroSubtextStyle = heroSubtextFontSize
    ? ({ fontSize: heroSubtextFontSize } as React.CSSProperties)
    : undefined;
  const themeUsesGlobal = settings?.theme_use_global !== false;
  const themeAccentSource = (() => {
    const globalAccent = settings?.theme_accent?.trim();
    if (themeUsesGlobal) return globalAccent;
    const homeAccent = (settings as any)?.home_theme_accent;
    if (typeof homeAccent === "string" && homeAccent.trim()) return homeAccent.trim();
    return globalAccent;
  })();
  const themeAccent = normalizeHex(themeAccentSource || "#FFD700", "#FFD700");
  const customBadgeColor = heroBadgeUseTheme
    ? themeAccent
    : normalizeHex(settings?.hero_badge_color || themeAccent, themeAccent);
  const customBadgeText = heroBadgeUseTheme
    ? pickTextColor(customBadgeColor)
    : normalizeHex(settings?.hero_badge_text_color || pickTextColor(customBadgeColor), pickTextColor(customBadgeColor));
  const heroBadgeThemeStyle = useMemo(() => {
    if (!heroBadgeEnabled) return undefined;
    if (heroBadgeUseTheme) return undefined;
    if (heroBadgeVariant === "bold") {
      return {
        backgroundColor: customBadgeColor,
        color: customBadgeText,
        borderColor: blendColors(customBadgeColor, "#000000", 0.25),
      } as React.CSSProperties;
    }
    const softBackground = blendColors(customBadgeColor, "#FFFFFF", 0.82);
    const softBorder = blendColors(customBadgeColor, "#000000", 0.3);
    return {
      backgroundColor: softBackground,
      color: customBadgeText,
      borderColor: softBorder,
    } as React.CSSProperties;
  }, [customBadgeColor, customBadgeText, heroBadgeEnabled, heroBadgeUseTheme, heroBadgeVariant]);
  const heroBadgeStyle = useMemo(() => {
    if (!heroBadgeEnabled) return heroBadgeThemeStyle;
    if (!heroBadgeFontSize) return heroBadgeThemeStyle;
    return { ...(heroBadgeThemeStyle || {}), fontSize: heroBadgeFontSize } as React.CSSProperties;
  }, [heroBadgeEnabled, heroBadgeFontSize, heroBadgeThemeStyle]);
  const heroBadgeClasses = useMemo(() => {
    if (!heroBadgeEnabled) return "";
    const base = `inline-flex items-center gap-2 font-semibold uppercase ${heroBadgeClass}`;
    if (heroBadgeUseTheme) {
      return `${heroBadgeVariant === "bold" ? "theme-accent-button" : "theme-accent-chip"} ${base}`;
    }
    return `${base} border`;
  }, [heroBadgeClass, heroBadgeEnabled, heroBadgeUseTheme, heroBadgeVariant]);
  const whoTitle = settings?.who_title?.trim() || "Who We Are";
  const whoBody =
    settings?.who_body?.trim() ||
    "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.";
  const whoCtaLabel = settings?.who_cta_label?.trim() || "Meet the Team";
  const whoCtaUrl = settings?.who_cta_url?.trim() || "/about";
  const whoIsExternal = /^https?:/i.test(whoCtaUrl);
  const whoLabelRaw = settings?.who_label?.trim() || "Who We Are";
  const whoShowLabel = resolveBool(settings?.who_show_label, true);
  const whoLabelSize = resolveSize(settings?.who_label_size);
  const whoTitleSize = resolveSize(settings?.who_title_size);
  const whoBodySize = resolveSize(settings?.who_body_size);
  const whoLabelClass = WHO_LABEL_CLASSES[whoLabelSize];
  const whoTitleClass = WHO_TITLE_CLASSES[whoTitleSize];
  const whoBodyClass = WHO_BODY_CLASSES[whoBodySize];
  const normalizedLabel = whoLabelRaw.toLowerCase();
  const normalizedTitle = whoTitle.toLowerCase();
  const renderWhoLabel = whoShowLabel && whoLabelRaw && normalizedLabel !== normalizedTitle;

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
                {heroBadgeEnabled ? (
                  <span className={heroBadgeClasses} style={heroBadgeStyle}>
                    {heroBadgeLabel}
                  </span>
                ) : null}
                <h1 className={`font-bold leading-tight text-theme-accent ${heroTitleClass}`} style={heroTitleStyle}>
                  {heroTitle}
                </h1>
                <p className={`max-w-xl break-words text-theme-muted ${heroSubtextClass}`} style={heroSubtextStyle}>
                  {heroSubtext}
                </p>
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
                <div className="flex justify-center">
                  <div className="relative mx-auto aspect-[3/2] min-h-[200px] w-full min-w-0 overflow-hidden rounded-2xl border border-theme-surface bg-theme-background max-h-[55vh] sm:min-h-[280px] sm:max-h-none lg:min-h-[360px]">
                    {heroImage ? (
                      <img
                        src={heroImage}
                        alt={heroTitle || "Too Funny Productions hero"}
                        className="h-full w-full max-h-full max-w-full object-cover"
                        onError={handleHeroImageError}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-theme-muted">
                        Add a hero image in the admin panel to complete the look.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative w-full overflow-hidden rounded-3xl border border-theme-surface bg-theme-surface p-4 shadow-xl sm:p-5 lg:p-6">
                <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-[0.4em] text-theme-accent-soft">
                  Featured Video
                </p>
                <div className="flex justify-center">
                  <div className="mx-auto aspect-video w-full min-w-0 overflow-hidden rounded-2xl border border-theme-surface bg-theme-background max-h-[55vh] sm:max-h-none">
                    {heroVideo ? (
                      <video
                        src={heroVideo}
                        controls
                        preload="metadata"
                        className="h-full w-full max-h-full max-w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-theme-muted">
                        Add a featured video in the admin panel to showcase your latest work.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-8 sm:mt-[4.5rem] sm:gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
          <div className="min-w-0 w-full rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-lg sm:p-7 md:p-8">
            <div className="space-y-4">
              <div className="space-y-2">
                {renderWhoLabel ? (
                  <p className={`uppercase text-theme-accent-soft ${whoLabelClass}`}>{whoLabelRaw}</p>
                ) : null}
                <h2 className={`font-semibold text-theme-accent ${whoTitleClass}`}>{whoTitle}</h2>
              </div>
              <p className={`break-words leading-relaxed text-theme-muted ${whoBodyClass}`}>{whoBody}</p>
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
                  className="theme-accent-outline rounded-full px-4 py-2 text-sm font-semibold"
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
                  className="theme-accent-button rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em]"
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
