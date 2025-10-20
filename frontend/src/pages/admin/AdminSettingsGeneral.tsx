// frontend/src/pages/admin/AdminSettingsGeneral.tsx
// Admin Settings → General (global site settings)
// Branding, theme colors, footer links, maintenance, admin session timeout

import React, { useEffect, useMemo, useState } from "react";
import { useSettings } from "../../lib/SettingsContext";
import SettingsUploader from "./SettingsUploader";
import SettingsColorPicker from "./SettingsColorPicker";
import SettingsLinkManager from "./SettingsLinkManager";

type GeneralFields = {
  site_title?: string;
  site_description?: string;
  site_keywords?: string;

  logo_url?: string;
  favicon_url?: string;

  footer_text?: string;
  footer_links?: { label: string; url: string }[];

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

  session_timeout_minutes?: number; // admin session dropdown
};

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60];

const mapSettingsToLocal = (safe: Record<string, any>): GeneralFields => ({
  site_title: safe.site_title || "Too Funny Productions",
  site_description: safe.site_description || "",
  site_keywords: safe.site_keywords || "",

  logo_url: safe.logo_url || "",
  favicon_url: safe.favicon_url || "",

  footer_text: safe.footer_text || "© 2025 Too Funny Productions. All rights reserved.",
  footer_links: Array.isArray(safe.footer_links) ? [...safe.footer_links] : [],

  theme_accent: safe.theme_accent || "#FFD700",
  theme_bg: safe.theme_bg || "#111111",
  header_bg: safe.header_bg || "#000000",
  footer_bg: safe.footer_bg || "#000000",

  maintenance_enabled: !!safe.maintenance_enabled,
  maintenance_message: safe.maintenance_message || "We’ll be right back…",
  maintenance_schedule_enabled: !!safe.maintenance_schedule_enabled,
  maintenance_daily_start: safe.maintenance_daily_start || "",
  maintenance_daily_end: safe.maintenance_daily_end || "",
  maintenance_timezone: safe.maintenance_timezone || "America/Chicago",

  session_timeout_minutes:
    typeof safe.session_timeout_minutes === "number" ? safe.session_timeout_minutes : 30,
});

type SaveStatus =
  | { type: "idle" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

export default function AdminSettingsGeneral() {
  const { settings, save, stage, saving } = useSettings();
  const safe = settings || {};

  const baseline = useMemo(() => mapSettingsToLocal(safe), [safe]);
  const [local, setLocal] = useState<GeneralFields>(baseline);
  const [status, setStatus] = useState<SaveStatus>({ type: "idle" });

  useEffect(() => {
    setLocal(baseline);
    setStatus({ type: "idle" });
  }, [baseline]);

  useEffect(() => {
    if (status.type === "idle") return;
    const timer = window.setTimeout(() => setStatus({ type: "idle" }), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const handle = (k: keyof GeneralFields, v: any) =>
    setLocal((prev) => ({ ...prev, [k]: v }));

  const canSave = useMemo(() => {
    if (stage !== "draft") return false;
    return JSON.stringify(local) !== JSON.stringify(baseline);
  }, [baseline, local, stage]);

  const onSave = async () => {
    if (stage !== "draft") {
      setStatus({ type: "error", message: "Switch to Draft mode before saving." });
      return;
    }

    try {
      setStatus({ type: "idle" });
      await save(local);
      setStatus({ type: "success", message: "Draft updated." });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message || "Failed to save general settings." });
    }
  };

  return (
    <div className="space-y-10">
      {/* Branding */}
      <section>
        <h3 className="text-xl font-bold mb-3">Branding</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <div className="font-semibold mb-1">Site Title</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.site_title || ""}
              onChange={(e) => handle("site_title", e.target.value)}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">Site Description</div>
            <textarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[70px]"
              value={local.site_description || ""}
              onChange={(e) => handle("site_description", e.target.value)}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="font-semibold mb-1">SEO Keywords</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="comma,separated,keywords"
              value={local.site_keywords || ""}
              onChange={(e) => handle("site_keywords", e.target.value)}
            />
          </label>

          <SettingsUploader
            label="Logo"
            value={local.logo_url || ""}
            onChange={(url) => handle("logo_url", url)}
            accept="image/*"
            buttonLabel="Select Logo"
          />
          <SettingsUploader
            label="Favicon"
            value={local.favicon_url || ""}
            onChange={(url) => handle("favicon_url", url)}
            accept="image/*"
            buttonLabel="Select Favicon"
          />
        </div>
      </section>

      {/* Theme Colors */}
      <section>
        <h3 className="text-xl font-bold mb-3">Theme Colors</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <SettingsColorPicker
            label="Accent Color"
            value={local.theme_accent || "#FFD700"}
            onChange={(v) => handle("theme_accent", v)}
          />
          <SettingsColorPicker
            label="Page Background"
            value={local.theme_bg || "#111111"}
            onChange={(v) => handle("theme_bg", v)}
          />
          <SettingsColorPicker
            label="Header Background"
            value={local.header_bg || "#000000"}
            onChange={(v) => handle("header_bg", v)}
          />
          <SettingsColorPicker
            label="Footer Background"
            value={local.footer_bg || "#000000"}
            onChange={(v) => handle("footer_bg", v)}
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
            value={local.footer_text || ""}
            onChange={(e) => handle("footer_text", e.target.value)}
          />
        </label>

        <SettingsLinkManager
          label="Footer Links"
          value={local.footer_links || []}
          onChange={(v) => handle("footer_links", v)}
          addLabel="Add Footer Link"
        />
      </section>

      {/* Maintenance Mode */}
      <section>
        <h3 className="text-xl font-bold mb-3">Maintenance</h3>
        <div className="flex items-center gap-2 mb-3">
          <input
            id="maint_enabled"
            type="checkbox"
            checked={!!local.maintenance_enabled}
            onChange={(e) => handle("maintenance_enabled", e.target.checked)}
          />
          <label htmlFor="maint_enabled" className="select-none">
            Enable Manual Maintenance Mode
          </label>
        </div>

        <label className="block mb-3">
          <div className="font-semibold mb-1">Maintenance Message</div>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.maintenance_message || ""}
            onChange={(e) => handle("maintenance_message", e.target.value)}
          />
        </label>

        <div className="flex items-center gap-2 mb-3">
          <input
            id="maint_schedule"
            type="checkbox"
            checked={!!local.maintenance_schedule_enabled}
            onChange={(e) => handle("maintenance_schedule_enabled", e.target.checked)}
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
              value={local.maintenance_daily_start || ""}
              onChange={(e) => handle("maintenance_daily_start", e.target.value)}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Daily End (HH:MM)</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="02:30"
              value={local.maintenance_daily_end || ""}
              onChange={(e) => handle("maintenance_daily_end", e.target.value)}
            />
          </label>
          <label className="block">
            <div className="font-semibold mb-1">Timezone</div>
            <input
              className="w-full border border-gray-300 rounded px-3 py-2 text-black"
              placeholder="America/Chicago"
              value={local.maintenance_timezone || ""}
              onChange={(e) => handle("maintenance_timezone", e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* Admin Session Timeout */}
      <section>
        <h3 className="text-xl font-bold mb-3">Admin Session Timeout</h3>
        <p className="text-sm text-gray-600 mb-3">
          How long can the admin panel remain idle before auto-logout? This only applies to the admin
          dashboard.
        </p>
        <select
          className="border border-gray-300 rounded px-3 py-2 text-black bg-white"
          value={local.session_timeout_minutes ?? 30}
          onChange={(e) => handle("session_timeout_minutes", Number(e.target.value))}
        >
          {TIMEOUT_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className={`self-start px-4 py-2 rounded font-semibold ${
              !canSave || saving
                ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {saving ? "Saving…" : "Save General Settings"}
          </button>

          {status.type === "success" ? (
            <p className="text-sm text-green-600">{status.message}</p>
          ) : null}
          {status.type === "error" ? <p className="text-sm text-red-600">{status.message}</p> : null}
          {stage !== "draft" ? (
            <p className="text-xs text-gray-600">
              Viewing live values. Switch to <span className="font-semibold">Draft</span> to make edits.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
