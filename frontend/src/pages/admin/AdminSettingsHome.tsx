/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsHome.tsx
   -------------------------------------------------------------------------
   Home page fields wired to SettingsContext with media pickers.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import MediaPickerModal from "../../components/MediaPickerModal";
import UploadFromComputerButton from "../../components/admin/UploadFromComputerButton";
import { normalizeAdminUrl } from "../../utils/url";
import AdminPageThemeOverride from "./AdminPageThemeOverride";
import SettingsColorPicker from "./SettingsColorPicker";

type SizeOption = "small" | "medium" | "large";
type BadgeVariant = "soft" | "bold";

const normalizeSize = (value: unknown): SizeOption => {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "small" || trimmed === "medium" || trimmed === "large") {
      return trimmed as SizeOption;
    }
  }
  return "medium";
};

const normalizeVariant = (value: unknown): BadgeVariant => (value === "bold" ? "bold" : "soft");

const normalizeBool = (value: unknown, fallback: boolean): boolean => {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
};

const TEXT_SIZE_OPTIONS: { label: string; value: SizeOption }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

type HomeSettings = {
  hero_title: string;
  hero_subtext: string;
  hero_image_url: string;
  featured_video_url: string;
  who_title: string;
  who_body: string;
  who_cta_label: string;
  who_cta_url: string;
  who_image_url: string;
  who_label: string;
  who_show_label: boolean;
  who_label_size: SizeOption;
  who_title_size: SizeOption;
  who_body_size: SizeOption;
  hero_title_size: SizeOption;
  hero_subtext_size: SizeOption;
  hero_badge_size: SizeOption;
  hero_badge_enabled: boolean;
  hero_badge_label: string;
  hero_badge_variant: BadgeVariant;
  hero_badge_use_theme_color: boolean;
  hero_badge_color: string;
  hero_badge_text_color: string;
};

const sanitize = (raw: unknown): HomeSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const siteTitle = typeof safe.site_title === "string" ? safe.site_title : "Too Funny Productions";
  return {
    hero_title: typeof safe.hero_title === "string" ? safe.hero_title : "",
    hero_subtext: typeof safe.hero_subtext === "string" ? safe.hero_subtext : "",
    hero_image_url: typeof safe.hero_image_url === "string" ? safe.hero_image_url : "",
    featured_video_url:
      typeof safe.featured_video_url === "string" ? safe.featured_video_url : "",
    who_title: typeof safe.who_title === "string" ? safe.who_title : "",
    who_body: typeof safe.who_body === "string" ? safe.who_body : "",
    who_cta_label: typeof safe.who_cta_label === "string" ? safe.who_cta_label : "Meet the Team",
    who_cta_url: typeof safe.who_cta_url === "string" ? safe.who_cta_url : "/about",
    who_image_url: typeof safe.who_image_url === "string" ? safe.who_image_url : "",
    who_label: typeof safe.who_label === "string" ? safe.who_label : "Who We Are",
    who_show_label: normalizeBool(safe.who_show_label, true),
    who_label_size: normalizeSize(safe.who_label_size),
    who_title_size: normalizeSize(safe.who_title_size),
    who_body_size: normalizeSize(safe.who_body_size),
    hero_title_size: normalizeSize(safe.hero_title_size),
    hero_subtext_size: normalizeSize(safe.hero_subtext_size),
    hero_badge_size: normalizeSize(safe.hero_badge_size),
    hero_badge_enabled: normalizeBool(safe.hero_badge_enabled, true),
    hero_badge_label:
      typeof safe.hero_badge_label === "string" && safe.hero_badge_label.trim().length > 0
        ? safe.hero_badge_label
        : siteTitle,
    hero_badge_variant: normalizeVariant(safe.hero_badge_variant),
    hero_badge_use_theme_color: normalizeBool(safe.hero_badge_use_theme_color, true),
    hero_badge_color: typeof safe.hero_badge_color === "string" ? safe.hero_badge_color : "",
    hero_badge_text_color:
      typeof safe.hero_badge_text_color === "string" ? safe.hero_badge_text_color : "",
  };
};

export default function AdminSettingsHome() {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<HomeSettings>(safe);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [showVideoPicker, setShowVideoPicker] = useState(false);
  const [showWhoImagePicker, setShowWhoImagePicker] = useState(false);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const update = <K extends keyof HomeSettings>(key: K, value: HomeSettings[K]) => {
    if (disabled) return;
    let nextValue = value;
    if (typeof value === "string") {
      if (key.toString().includes("_url")) {
        nextValue = normalizeAdminUrl(value) as HomeSettings[K];
      } else if (key.toString().endsWith("_size")) {
        nextValue = normalizeSize(value) as HomeSettings[K];
      }
    }
    setLocal((prev) => ({ ...prev, [key]: nextValue }));
    setField(key as string, nextValue);
  };

  return (
    <div className="space-y-6">
      {lockedByOther ? (
        <p className="mb-2 rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Draft is currently locked by another editor. Fields are read-only until the lock is released.
        </p>
      ) : stage !== "draft" ? (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Switch to the Draft view to edit the home page content.
        </p>
      ) : null}

      <section className="space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Hero Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.hero_title}
            onChange={(event) => update("hero_title", event.target.value)}
            disabled={disabled}
            placeholder="Comedy that's Too Funny"
          />
          <p className="mt-1 text-xs text-gray-500">
            Appears as the large headline in the hero banner on the public home page.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Hero Subtext</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            rows={3}
            value={local.hero_subtext}
            onChange={(event) => update("hero_subtext", event.target.value)}
            disabled={disabled}
            placeholder="Original sketch, live shows, and shamelessly fun chaos."
          />
          <p className="mt-1 text-xs text-gray-500">
            Short supporting copy that sits directly beneath the hero headline.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white/60 p-4 shadow-sm space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Hero Highlight</h3>
            <p className="mt-1 text-xs text-gray-600">
              Control the badge that appears above the hero headline. Turn it off entirely or customize the tone and colors.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-400"
              checked={local.hero_badge_enabled}
              onChange={(event) => update("hero_badge_enabled", event.target.checked)}
              disabled={disabled}
            />
            Show highlight
          </label>
        </div>

        <div className={`grid gap-3 sm:grid-cols-2 ${local.hero_badge_enabled ? "" : "opacity-60"}`}>
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Highlight Label
            </label>
            <input
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
              value={local.hero_badge_label}
              onChange={(event) => update("hero_badge_label", event.target.value)}
              disabled={disabled || !local.hero_badge_enabled}
              placeholder="Too Funny Productions"
            />
            <p className="text-[11px] text-gray-500">
              Defaults to your site title. Keep it short so it stays on one line.
            </p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Highlight Weight
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.hero_badge_variant}
              onChange={(event) => update("hero_badge_variant", event.target.value as BadgeVariant)}
              disabled={disabled || !local.hero_badge_enabled}
            >
              <option value="soft">Light</option>
              <option value="bold">Bold</option>
            </select>
          </div>
        </div>

        <div className={`space-y-3 rounded-md border border-gray-200 bg-white/80 p-3 ${local.hero_badge_enabled ? "" : "opacity-60"}`}>
          <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-400"
              checked={local.hero_badge_use_theme_color}
              onChange={(event) => update("hero_badge_use_theme_color", event.target.checked)}
              disabled={disabled || !local.hero_badge_enabled}
            />
            Use theme accent colors
          </label>
          <p className="text-[11px] text-gray-500">
            Turn this off to set a custom background and text color for the highlight badge.
          </p>

          {local.hero_badge_use_theme_color ? null : (
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsColorPicker
                label="Badge background"
                value={local.hero_badge_color || "#FFD700"}
                onChange={(value) => update("hero_badge_color", value)}
                disabled={disabled || !local.hero_badge_enabled}
              />
              <SettingsColorPicker
                label="Badge text"
                value={local.hero_badge_text_color || "#111111"}
                onChange={(value) => update("hero_badge_text_color", value)}
                disabled={disabled || !local.hero_badge_enabled}
              />
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white/60 p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Hero Text Sizing</h3>
          <p className="mt-1 text-xs text-gray-600">
            Apply small, medium, or large presets to the hero badge, headline, and supporting text.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Highlight
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.hero_badge_size}
              onChange={(event) => update("hero_badge_size", event.target.value as SizeOption)}
              disabled={disabled}
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Headline
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.hero_title_size}
              onChange={(event) => update("hero_title_size", event.target.value as SizeOption)}
              disabled={disabled}
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Supporting Text
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.hero_subtext_size}
              onChange={(event) => update("hero_subtext_size", event.target.value as SizeOption)}
              disabled={disabled}
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white/60 p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Who Section Text Sizing</h3>
          <p className="mt-1 text-xs text-gray-600">
            Tune the label, heading, and paragraph sizes that appear in the “Who We Are” spotlight.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Label
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.who_label_size}
              onChange={(event) => update("who_label_size", event.target.value as SizeOption)}
              disabled={disabled}
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={`who-label-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Title
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.who_title_size}
              onChange={(event) => update("who_title_size", event.target.value as SizeOption)}
              disabled={disabled}
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={`who-title-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Body Copy
            </label>
            <select
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              value={local.who_body_size}
              onChange={(event) => update("who_body_size", event.target.value as SizeOption)}
              disabled={disabled}
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={`who-body-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm font-semibold">Featured Video</label>
          <p className="text-xs text-gray-500">
            This optional clip displays in the “Featured Video” card to highlight your latest reel or teaser.
          </p>
          <div className="space-y-2">
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.featured_video_url}
              onChange={(event) => update("featured_video_url", event.target.value)}
              disabled={disabled}
              placeholder="https://…/video.mp4"
            />
            <div className="flex flex-wrap items-start gap-2 text-sm">
              <button
                type="button"
                onClick={() => setShowVideoPicker(true)}
                disabled={disabled}
                className={`rounded px-3 py-1 font-semibold ${
                  disabled
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                Select from library
              </button>
              <UploadFromComputerButton
                onUploaded={(url) => update("featured_video_url", url)}
                accept="video/*"
                disabled={disabled}
                className="border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              >
                Upload from computer
              </UploadFromComputerButton>
              <button
                type="button"
                onClick={() => update("featured_video_url", "")}
                disabled={disabled || !local.featured_video_url}
                className={`rounded px-3 py-1 font-semibold ${
                  disabled || !local.featured_video_url
                    ? "cursor-not-allowed bg-gray-200 text-gray-500"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Remove video
              </button>
              {local.featured_video_url ? (
                <a
                  href={local.featured_video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                    className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
                  >
                    Open current
                  </a>
                ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-semibold">Hero Image</label>
          <p className="text-xs text-gray-500">
            Shown alongside the hero text as a bold still image. Horizontal images (3:2) work best.
          </p>
          <div className="space-y-2">
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.hero_image_url}
              onChange={(event) => update("hero_image_url", event.target.value)}
              disabled={disabled}
              placeholder="https://…/hero.jpg"
            />
            <div className="flex flex-wrap items-start gap-2 text-sm">
              <button
                type="button"
                onClick={() => setShowHeroPicker(true)}
                disabled={disabled}
                className={`rounded px-3 py-1 font-semibold ${
                  disabled
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                Select from library
              </button>
              <UploadFromComputerButton
                onUploaded={(url) => update("hero_image_url", url)}
                accept="image/*"
                disabled={disabled}
                className="border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              >
                Upload from computer
              </UploadFromComputerButton>
              <button
                type="button"
                onClick={() => update("hero_image_url", "")}
                disabled={disabled || !local.hero_image_url}
                className={`rounded px-3 py-1 font-semibold ${
                  disabled || !local.hero_image_url
                    ? "cursor-not-allowed bg-gray-200 text-gray-500"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Remove image
              </button>
              {local.hero_image_url ? (
                <a
                  href={local.hero_image_url}
                  target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
                  >
                    Open current
                  </a>
                ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-semibold">Who We Are Image</label>
          <div className="space-y-2">
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.who_image_url}
              onChange={(event) => update("who_image_url", event.target.value)}
              disabled={disabled}
              placeholder="https://…/crew.jpg"
            />
            <div className="flex flex-wrap items-start gap-2 text-sm">
              <button
                type="button"
                onClick={() => setShowWhoImagePicker(true)}
                disabled={disabled}
                className={`rounded px-3 py-1 font-semibold ${
                  disabled
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                Select from library
              </button>
              <UploadFromComputerButton
                onUploaded={(url) => update("who_image_url", url)}
                accept="image/*"
                disabled={disabled}
                className="border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              >
                Upload from computer
              </UploadFromComputerButton>
              <button
                type="button"
                onClick={() => update("who_image_url", "")}
                disabled={disabled || !local.who_image_url}
                className={`rounded px-3 py-1 font-semibold ${
                  disabled || !local.who_image_url
                    ? "cursor-not-allowed bg-gray-200 text-gray-500"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Remove image
              </button>
              {local.who_image_url ? (
                <a
                  href={local.who_image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
                  >
                    Open current
                  </a>
                ) : null}
            </div>
          </div>
        </div>
      </section>

      <MediaPickerModal
        isOpen={showHeroPicker && !disabled}
        onClose={() => setShowHeroPicker(false)}
        onSelect={(item) => update("hero_image_url", item.url)}
        kind="image"
      />

      <MediaPickerModal
        isOpen={showVideoPicker && !disabled}
        onClose={() => setShowVideoPicker(false)}
        onSelect={(item) => update("featured_video_url", item.url)}
        kind="video"
      />

      <MediaPickerModal
        isOpen={showWhoImagePicker && !disabled}
        onClose={() => setShowWhoImagePicker(false)}
        onSelect={(item) => update("who_image_url", item.url)}
        kind="image"
      />

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-col gap-2 rounded border border-gray-200 bg-white/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold">Who We Are — Label</label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-400"
                  checked={local.who_show_label}
                  onChange={(event) => update("who_show_label", event.target.checked)}
                  disabled={disabled}
                />
                Show label
              </label>
            </div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.who_label}
              onChange={(event) => update("who_label", event.target.value)}
              disabled={disabled || !local.who_show_label}
              placeholder="Who We Are"
            />
            <p className="text-xs text-gray-500">
              If the label matches the title, the public page will hide the duplicate automatically.
            </p>
          </div>

          <label className="block text-sm font-semibold">Who We Are — Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.who_title}
            onChange={(event) => update("who_title", event.target.value)}
            disabled={disabled}
            placeholder="Who We Are"
          />
          <label className="block text-sm font-semibold">Call to Action Label</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.who_cta_label}
            onChange={(event) => update("who_cta_label", event.target.value)}
            disabled={disabled}
            placeholder="Meet the Team"
          />
          <label className="block text-sm font-semibold">Call to Action Link</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.who_cta_url}
            onChange={(event) => update("who_cta_url", event.target.value)}
            disabled={disabled}
            placeholder="/about"
          />
          <p className="text-xs text-gray-500">
            The label and link power the primary button beneath the Who We Are copy. Use internal paths (e.g. /about) or full URLs.
          </p>
        </div>
        <div>
          <label className="block text-sm font-semibold">Who We Are — Body</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[150px]"
            value={local.who_body}
            onChange={(event) => update("who_body", event.target.value)}
            disabled={disabled}
            placeholder="Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv."
          />
          <p className="mt-1 text-xs text-gray-500">
            This section appears beneath the hero on the public home page.
          </p>
        </div>
      </section>

      <AdminPageThemeOverride prefix="home" pageName="Home" />
    </div>
  );
}
