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
};

const sanitize = (raw: unknown): HomeSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
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
    if (typeof value === "string" && key.toString().includes("_url")) {
      nextValue = normalizeAdminUrl(value) as HomeSettings[K];
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
