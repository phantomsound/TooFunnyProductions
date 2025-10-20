/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsGeneral.tsx
   -------------------------------------------------------------------------
   Admin Settings → General: branding, colors, maintenance, and session TTL.
   ========================================================================= */
import React from "react";

import React from "react";
import { useSettings } from "../../lib/SettingsContext";
import SettingsColorPicker from "./SettingsColorPicker";
import SettingsLinkManager from "./SettingsLinkManager";
import SettingsUploader from "./SettingsUploader";

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60];

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const color = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

  session_timeout_minutes?: number; // admin session dropdown
};

const bool = (value: unknown) => value === true;

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
  const disabled = stage !== "draft";

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

