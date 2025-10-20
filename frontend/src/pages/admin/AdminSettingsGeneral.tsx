// frontend/src/pages/admin/AdminSettingsGeneral.tsx
// Admin Settings → General (global site settings)
// Branding, theme colors, footer links, maintenance, admin session timeout

import React from "react";
import { useSettings } from "../../lib/SettingsContext";
import SettingsUploader from "./SettingsUploader";
import SettingsColorPicker from "./SettingsColorPicker";
import SettingsLinkManager from "./SettingsLinkManager";

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60];

const text = (value, fallback = "") =>
  typeof value === "string" ? value : fallback;

const color = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value : fallback;

const numeric = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const bool = (value) => value === true;

export default function AdminSettingsGeneral() {
  const { settings, setField, stage } = useSettings();
  const safe = settings || {};
  const disabled = stage !== "draft";

  const update = (key, value) => {
    if (disabled) return;
    setField(key, value);
  };

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
              onChange={(e) => update("site_title", e.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">Site Description</div>
            <textarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[70px]"
              value={text(safe.site_description)}
              onChange={(e) => update("site_description", e.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">SEO Keywords</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="comma,separated,keywords"
              value={text(safe.site_keywords)}
              onChange={(e) => update("site_keywords", e.target.value)}
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
            onChange={(v) => update("theme_accent", v)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Page Background"
            value={color(safe.theme_bg, "#111111")}
            onChange={(v) => update("theme_bg", v)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Header Background"
            value={color(safe.header_bg, "#000000")}
            onChange={(v) => update("header_bg", v)}
            disabled={disabled}
          />
          <SettingsColorPicker
            label="Footer Background"
            value={color(safe.footer_bg, "#000000")}
            onChange={(v) => update("footer_bg", v)}
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
            onChange={(e) => update("footer_text", e.target.value)}
            disabled={disabled}
          />
        </label>

        <SettingsLinkManager
          label="Footer Links"
          value={Array.isArray(safe.footer_links) ? safe.footer_links : []}
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
            onChange={(e) => update("maintenance_enabled", e.target.checked)}
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
            onChange={(e) => update("maintenance_message", e.target.value)}
            disabled={disabled}
          />
        </label>

        <div className="flex items-center gap-2 mb-3">
          <input
            id="maint_schedule"
            type="checkbox"
            checked={bool(safe.maintenance_schedule_enabled)}
            onChange={(e) => update("maintenance_schedule_enabled", e.target.checked)}
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
              onChange={(e) => update("maintenance_daily_start", e.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Daily End (HH:MM)</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="02:30"
              value={text(safe.maintenance_daily_end)}
              onChange={(e) => update("maintenance_daily_end", e.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Timezone</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="America/Chicago"
              value={text(safe.maintenance_timezone)}
              onChange={(e) => update("maintenance_timezone", e.target.value)}
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
          onChange={(e) => update("session_timeout_minutes", Number(e.target.value))}
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
