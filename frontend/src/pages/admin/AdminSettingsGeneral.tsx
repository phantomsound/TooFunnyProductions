/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsGeneral.tsx
   -------------------------------------------------------------------------
   Admin Settings → General: branding, colors, maintenance, and session TTL.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsColorPicker from "./SettingsColorPicker";
import SettingsLinkManager from "./SettingsLinkManager";
import SettingsUploader from "./SettingsUploader";

interface FooterLink {
  label: string;
  url: string;
}

interface GeneralSettings {
  site_title: string;
  site_description: string;
  site_keywords: string;

  logo_url: string;
  favicon_url: string;

  footer_text: string;
  footer_links: FooterLink[];

  theme_accent: string;
  theme_bg: string;
  header_bg: string;
  footer_bg: string;

  maintenance_enabled: boolean;
  maintenance_message: string;
  maintenance_schedule_enabled: boolean;
  maintenance_daily_start: string;
  maintenance_daily_end: string;
  maintenance_timezone: string;

  session_timeout_minutes: number;
}

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60] as const;

const coerceText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const coerceColor = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const coerceNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const coerceBool = (value: unknown): boolean => value === true;

const coerceLinks = (value: unknown): FooterLink[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FooterLink =>
      !!item &&
      typeof item === "object" &&
      typeof (item as FooterLink).label === "string" &&
      typeof (item as FooterLink).url === "string"
    )
    .map((item) => ({ label: item.label, url: item.url }));
};

const sanitizeSettings = (raw: unknown): GeneralSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sanitized: GeneralSettings = {
    site_title: coerceText(safe.site_title, "Too Funny Productions"),
    site_description: coerceText(safe.site_description),
    site_keywords: coerceText(safe.site_keywords),

    logo_url: coerceText(safe.logo_url),
    favicon_url: coerceText(safe.favicon_url),

    footer_text: coerceText(
      safe.footer_text,
      "© 2025 Too Funny Productions. All rights reserved."
    ),
    footer_links: coerceLinks(safe.footer_links),

    theme_accent: coerceColor(safe.theme_accent, "#FFD700"),
    theme_bg: coerceColor(safe.theme_bg, "#111111"),
    header_bg: coerceColor(safe.header_bg, "#000000"),
    footer_bg: coerceColor(safe.footer_bg, "#000000"),

    maintenance_enabled: coerceBool(safe.maintenance_enabled),
    maintenance_message: coerceText(safe.maintenance_message, "We’ll be right back…"),
    maintenance_schedule_enabled: coerceBool(safe.maintenance_schedule_enabled),
    maintenance_daily_start: coerceText(safe.maintenance_daily_start),
    maintenance_daily_end: coerceText(safe.maintenance_daily_end),
    maintenance_timezone: coerceText(safe.maintenance_timezone, "America/Chicago"),

    session_timeout_minutes: coerceNumber(safe.session_timeout_minutes, 30),
  };

  return sanitized;
};

export default function AdminSettingsGeneral(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitizeSettings(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<GeneralSettings>(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const update = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const footerLinks = local.footer_links;

  return (
    <div className="space-y-10">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      {/* Branding */}
      <section>
        <h3 className="text-xl font-bold mb-3">Branding</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <div className="font-semibold mb-1">Site Title</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.site_title}
              onChange={(event) => update("site_title", event.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">Site Description</div>
            <textarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[70px]"
              value={local.site_description}
              onChange={(event) => update("site_description", event.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">SEO Keywords</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="comma,separated,keywords"
              value={local.site_keywords}
              onChange={(event) => update("site_keywords", event.target.value)}
              disabled={disabled}
            />
          </label>

          <SettingsUploader
            label="Logo"
            value={local.logo_url}
            onChange={(url) => update("logo_url", url)}
            accept="image/*"
            buttonLabel="Select Logo"
            disabled={disabled}
          />
          <SettingsUploader
            label="Favicon"
            value={local.favicon_url}
            onChange={(url) => update("favicon_url", url)}
            accept="image/*"
            buttonLabel="Select Favicon"
            disabled={disabled}
          />
        </div>
      </section>

      {/* Theme Colors */}
      <section>
        <h3 className="text-xl font-bold mb-3">Theme Colors</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <SettingsColorPicker
            label="Accent Color"
            value={local.theme_accent}
            onChange={(value: string) => update("theme_accent", value)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Page Background"
            value={local.theme_bg}
            onChange={(value: string) => update("theme_bg", value)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Header Background"
            value={local.header_bg}
            onChange={(value: string) => update("header_bg", value)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Footer Background"
            value={local.footer_bg}
            onChange={(value: string) => update("footer_bg", value)}
            disabled={disabled}
          />
        </div>
        <p className="text-xs opacity-80 mt-2">
          We can add per-page color overrides later (About/Events/etc.) if you want distinct looks.
        </p>
      </section>

      {/* Footer */}
      <section>
        <h3 className="text-xl font-bold mb-3">Footer</h3>
        <label className="block mb-3">
          <div className="font-semibold mb-1">Footer Text</div>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[60px]"
            value={local.footer_text}
            onChange={(event) => update("footer_text", event.target.value)}
            disabled={disabled}
          />
        </label>

        <SettingsLinkManager
          label="Footer Links"
          value={footerLinks}
          onChange={(links) => update("footer_links", links)}
          addLabel="Add Footer Link"
          disabled={disabled}
        />
      </section>

      {/* Maintenance Mode */}
      <section>
        <h3 className="text-xl font-bold mb-3">Maintenance</h3>
        <div className="flex items-center gap-2 mb-3">
          <input
            id="maint_enabled"
            type="checkbox"
            checked={local.maintenance_enabled}
            onChange={(event) => update("maintenance_enabled", event.target.checked)}
            disabled={disabled}
          />
          <label htmlFor="maint_enabled" className="select-none">
            Enable Manual Maintenance Mode
          </label>
        </div>

        <label className="block mb-3">
          <div className="font-semibold mb-1">Maintenance Message</div>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.maintenance_message}
            onChange={(event) => update("maintenance_message", event.target.value)}
            disabled={disabled}
          />
        </label>

        <div className="flex items-center gap-2 mb-3">
          <input
            id="maint_schedule"
            type="checkbox"
            checked={local.maintenance_schedule_enabled}
            onChange={(event) => update("maintenance_schedule_enabled", event.target.checked)}
            disabled={disabled}
          />
          <label htmlFor="maint_schedule" className="select-none">
            Use Daily Maintenance Window
          </label>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <div className="font-semibold mb-1">Daily Start (HH:MM)</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="02:00"
              value={local.maintenance_daily_start}
              onChange={(event) => update("maintenance_daily_start", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Daily End (HH:MM)</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="02:30"
              value={local.maintenance_daily_end}
              onChange={(event) => update("maintenance_daily_end", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Timezone</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="America/Chicago"
              value={local.maintenance_timezone}
              onChange={(event) => update("maintenance_timezone", event.target.value)}
              disabled={disabled}
            />
          </label>
        </div>
      </section>

      {/* Admin Session Timeout */}
      <section>
        <h3 className="text-xl font-bold mb-3">Admin Session Timeout</h3>
        <p className="text-sm text-gray-600 mb-3">
          Draft edits are saved automatically before sessions expire. Choose how long admins remain logged in.
        </p>
        <select
          className="border border-gray-300 rounded px-3 py-2 text-black bg-white"
          value={local.session_timeout_minutes}
          onChange={(event) => update("session_timeout_minutes", Number(event.target.value))}
          disabled={disabled}
        >
          {TIMEOUT_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </section>
    </div>
  );
}

