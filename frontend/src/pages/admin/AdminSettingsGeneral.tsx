/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsGeneral.tsx
   -------------------------------------------------------------------------
   Admin Settings → General: branding, colors, maintenance, and session TTL.
   ========================================================================= */
import React from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsColorPicker from "./SettingsColorPicker";
import SettingsLinkManager from "./SettingsLinkManager";
import SettingsUploader from "./SettingsUploader";

type FooterLink = {
  label: string;
  url: string;
};

type GeneralSettings = {
  site_title?: string;
  site_description?: string;
  site_keywords?: string;

  logo_url?: string;
  favicon_url?: string;

  footer_text?: string;
  footer_links?: FooterLink[];

  theme_accent?: string;
  theme_bg?: string;
  header_bg?: string;
  footer_bg?: string;

  maintenance_enabled?: boolean;
  maintenance_message?: string;
  maintenance_schedule_enabled?: boolean;
  maintenance_daily_start?: string | null;
  maintenance_daily_end?: string | null;
  maintenance_timezone?: string | null;

  session_timeout_minutes?: number | null;
};

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60] as const;

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const color = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const numeric = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const bool = (value: unknown): boolean => value === true;

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

export default function AdminSettingsGeneral(): JSX.Element {
  const { settings, setField, stage } = useSettings();

  const safe = (settings ?? {}) as GeneralSettings;
  const disabled = stage !== "draft";

  const update = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    if (disabled) return;
    setField(key as string, value);
  };

  const footerLinks = coerceLinks(safe.footer_links);

  return (
    <div className="space-y-10">
      {disabled ? (
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
              value={text(safe.site_title)}
              onChange={(event) => update("site_title", event.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">Site Description</div>
            <textarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[70px]"
              value={text(safe.site_description)}
              onChange={(event) => update("site_description", event.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">SEO Keywords</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="comma,separated,keywords"
              value={text(safe.site_keywords)}
              onChange={(event) => update("site_keywords", event.target.value)}
              disabled={disabled}
            />
          </label>

          <SettingsUploader
            label="Logo"
            value={text(safe.logo_url)}
            onChange={(url) => update("logo_url", url)}
            accept="image/*"
            buttonLabel="Select Logo"
            disabled={disabled}
          />
          <SettingsUploader
            label="Favicon"
            value={text(safe.favicon_url)}
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
            value={color(safe.theme_accent, "#FFD700")}
            onChange={(value: string) => update("theme_accent", value)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Page Background"
            value={color(safe.theme_bg, "#111111")}
            onChange={(value: string) => update("theme_bg", value)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Header Background"
            value={color(safe.header_bg, "#000000")}
            onChange={(value: string) => update("header_bg", value)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Footer Background"
            value={color(safe.footer_bg, "#000000")}
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
            value={text(safe.footer_text)}
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
            checked={bool(safe.maintenance_enabled)}
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
            value={text(safe.maintenance_message)}
            onChange={(event) => update("maintenance_message", event.target.value)}
            disabled={disabled}
          />
        </label>

        <div className="flex items-center gap-2 mb-3">
          <input
            id="maint_schedule"
            type="checkbox"
            checked={bool(safe.maintenance_schedule_enabled)}
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
              value={text(safe.maintenance_daily_start)}
              onChange={(event) => update("maintenance_daily_start", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Daily End (HH:MM)</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="02:30"
              value={text(safe.maintenance_daily_end)}
              onChange={(event) => update("maintenance_daily_end", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Timezone</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="America/Chicago"
              value={text(safe.maintenance_timezone)}
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
          value={numeric(safe.session_timeout_minutes, 30)}
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

