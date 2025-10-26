/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsGeneral.tsx
   -------------------------------------------------------------------------
   Admin Settings → General: branding, colors, maintenance, and session TTL.
   ========================================================================= */
import { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import { normalizeHex, pickTextColor } from "../../lib/color";
import SettingsColorPicker from "./SettingsColorPicker";
import SettingsLinkManager from "./SettingsLinkManager";
import SettingsUploader from "./SettingsUploader";
import { normalizeAdminUrl } from "../../utils/url";

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
  admin_quick_links: FooterLink[];

  theme_accent: string;
  theme_bg: string;
  header_bg: string;
  header_text_color: string;
  footer_bg: string;
  theme_use_global: boolean;

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
  const accentColor = coerceColor(safe.theme_accent, "#FFD700");
  const backgroundColor = coerceColor(safe.theme_bg, "#111111");
  const headerBackground = coerceColor(safe.header_bg, "#000000");
  const normalizedHeaderBg = normalizeHex(headerBackground, "#000000");
  const defaultHeaderText = pickTextColor(normalizedHeaderBg);
  const footerBackground = coerceColor(safe.footer_bg, "#000000");

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
    admin_quick_links: coerceLinks(safe.admin_quick_links).slice(0, 4),

    theme_accent: normalizeHex(accentColor, "#FFD700"),
    theme_bg: normalizeHex(backgroundColor, "#111111"),
    header_bg: normalizedHeaderBg,
    header_text_color: normalizeHex(coerceColor(safe.header_text_color, defaultHeaderText), defaultHeaderText),
    footer_bg: normalizeHex(footerBackground, "#000000"),
    theme_use_global: coerceBool(safe.theme_use_global) !== false,

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
    let nextValue = value;
    if (typeof value === "string" && ["logo_url", "favicon_url"].includes(String(key))) {
      nextValue = normalizeAdminUrl(value) as GeneralSettings[K];
    }
    setLocal((prev) => ({ ...prev, [key]: nextValue }));
    setField(key as string, nextValue);
  };

  const footerLinks = local.footer_links;
  const usingGlobalTheme = local.theme_use_global;

  return (
    <div className="space-y-10 text-neutral-100">
      {lockedByOther ? (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm font-semibold tracking-wide text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-amber-500/60 bg-amber-400/10 p-3 text-[13px] font-semibold uppercase tracking-wide text-amber-200">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      {/* Branding */}
      <section>
        <h3 className="mb-3 text-xl font-semibold text-yellow-200">Branding</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <div className="mb-1 text-base font-semibold text-neutral-100">Site Title</div>
            <input
              className="w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-3 text-lg font-semibold !text-white placeholder:text-neutral-400 focus:border-yellow-300 focus:outline-none focus:ring-0"
              value={local.site_title}
              onChange={(event) => update("site_title", event.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <div className="mb-1 font-semibold text-neutral-200">Site Description</div>
            <textarea
              className="min-h-[70px] w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-400 focus:border-yellow-300 focus:outline-none focus:ring-0"
              value={local.site_description}
              onChange={(event) => update("site_description", event.target.value)}
              disabled={disabled}
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <div className="mb-1 font-semibold text-neutral-200">SEO Keywords</div>
            <input
              className="w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-400 focus:border-yellow-300 focus:outline-none focus:ring-0"
              placeholder="comma,separated,keywords"
              value={local.site_keywords}
              onChange={(event) => update("site_keywords", event.target.value)}
              disabled={disabled}
            />
            <p className="mt-1 text-xs text-neutral-400">
              Separate each term with a comma (for example: <em>comedy, improv, sketch shows</em>). These help search engines
              understand what your site is about but do not appear on the page.
            </p>
          </label>

          <SettingsUploader
            label="Logo"
            value={local.logo_url}
            onChange={(url) => update("logo_url", url)}
            accept="image/*"
            buttonLabel="Select Logo"
            disabled={disabled}
            pickerKind="image"
            layout="inline"
          />
          <SettingsUploader
            label="Favicon"
            value={local.favicon_url}
            onChange={(url) => update("favicon_url", url)}
            accept="image/*"
            buttonLabel="Select Favicon"
            disabled={disabled}
            pickerKind="image"
            layout="inline"
          />
        </div>
      </section>

      {/* Theme Colors */}
      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="mb-1 text-xl font-semibold text-yellow-200">Theme Colors</h3>
            <p className="text-sm text-neutral-300">
              Use these pickers to set the accent and background colors that appear across the public site. Toggle the switch to
              allow each page to manage its own palette instead.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
            <input
              type="checkbox"
              className="h-4 w-4 accent-yellow-400"
              checked={usingGlobalTheme}
              onChange={(event) => update("theme_use_global", event.target.checked)}
              disabled={disabled}
            />
            <span>Apply theme colors site-wide</span>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsColorPicker
            label="Accent Color"
            value={local.theme_accent}
            onChange={(value: string) => update("theme_accent", value)}
            disabled={disabled || !usingGlobalTheme}
          />
          <SettingsColorPicker
            label="Page Background"
            value={local.theme_bg}
            onChange={(value: string) => update("theme_bg", value)}
            disabled={disabled || !usingGlobalTheme}
          />
          <SettingsColorPicker
            label="Header Background"
            value={local.header_bg}
            onChange={(value: string) => update("header_bg", value)}
            disabled={disabled || !usingGlobalTheme}
          />
          <SettingsColorPicker
            label="Header Text"
            value={local.header_text_color}
            onChange={(value: string) => update("header_text_color", value)}
            disabled={disabled || !usingGlobalTheme}
          />
          <SettingsColorPicker
            label="Footer Background"
            value={local.footer_bg}
            onChange={(value: string) => update("footer_bg", value)}
            disabled={disabled || !usingGlobalTheme}
          />
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          {usingGlobalTheme
            ? "These colors instantly theme the navigation, footer, and global accents."
            : "With the global theme disabled, colors fall back to each page’s defaults so you can customize them individually."}
        </p>
      </section>

      {/* Footer */}
      <section>
        <h3 className="mb-3 text-xl font-semibold text-yellow-200">Footer</h3>
        <label className="mb-3 block text-sm">
          <div className="mb-1 font-semibold text-neutral-200">Footer Text</div>
          <textarea
            className="min-h-[60px] w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-400 focus:border-yellow-300 focus:outline-none focus:ring-0"
            value={local.footer_text}
            onChange={(event) => update("footer_text", event.target.value)}
            disabled={disabled}
          />
        </label>

        <SettingsLinkManager
          label="Footer Links"
          value={local.footer_links}
          onChange={(links) => update("footer_links", links)}
          addLabel="Add Footer Link"
          disabled={disabled}
        />
      </section>

      <section>
        <h3 className="mb-3 text-xl font-semibold text-yellow-200">Admin Quick Links</h3>
        <p className="mb-3 text-sm text-neutral-300">
          Configure up to four shortcuts that appear under <span className="font-semibold text-yellow-100">Quick Links</span> in the admin
          sidebar. Perfect for Google Drive, documentation, or other team resources.
        </p>
        <SettingsLinkManager
          label="Sidebar Shortcuts"
          value={local.admin_quick_links}
          onChange={(links) =>
            update(
              "admin_quick_links",
              links
                .slice(0, 4)
                .map((link) => ({ label: link.label ?? "", url: link.url ?? "" }))
            )
          }
          addLabel="Add Quick Link"
          disabled={disabled}
          maxItems={4}
        />
      </section>

      {/* Maintenance Mode */}
      <section>
        <h3 className="mb-3 text-xl font-semibold text-yellow-200">Maintenance</h3>
        <div className="mb-3 flex items-center gap-2 text-sm text-neutral-200">
          <input
            id="maint_enabled"
            type="checkbox"
            className="h-4 w-4 accent-yellow-400"
            checked={local.maintenance_enabled}
            onChange={(event) => update("maintenance_enabled", event.target.checked)}
            disabled={disabled}
          />
          <label htmlFor="maint_enabled" className="select-none">
            Enable Manual Maintenance Mode
          </label>
        </div>

        <label className="mb-3 block text-sm">
          <div className="mb-1 font-semibold text-neutral-200">Maintenance Message</div>
          <input
            className="w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-400 focus:border-yellow-300 focus:outline-none focus:ring-0"
            value={local.maintenance_message}
            onChange={(event) => update("maintenance_message", event.target.value)}
            disabled={disabled}
          />
        </label>

        <div className="mb-3 flex items-center gap-2 text-sm text-neutral-200">
          <input
            id="maint_schedule"
            type="checkbox"
            className="h-4 w-4 accent-yellow-400"
            checked={local.maintenance_schedule_enabled}
            onChange={(event) => update("maintenance_schedule_enabled", event.target.checked)}
            disabled={disabled}
          />
          <label htmlFor="maint_schedule" className="select-none">
            Use Daily Maintenance Window
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">
            <div className="mb-1 font-semibold text-neutral-200">Daily Start (HH:MM)</div>
            <input
              className="w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
              placeholder="02:00"
              value={local.maintenance_daily_start}
              onChange={(event) => update("maintenance_daily_start", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 font-semibold text-neutral-200">Daily End (HH:MM)</div>
            <input
              className="w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
              placeholder="02:30"
              value={local.maintenance_daily_end}
              onChange={(event) => update("maintenance_daily_end", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 font-semibold text-neutral-200">Timezone</div>
            <input
              className="w-full rounded border border-neutral-700 !bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
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
        <h3 className="mb-3 text-xl font-semibold text-yellow-200">Admin Session Timeout</h3>
        <p className="mb-3 text-sm text-neutral-300">
          Draft edits are saved automatically before sessions expire. Choose how long admins remain logged in.
        </p>
        <select
          className="rounded border border-neutral-700 !bg-neutral-900 px-3 py-2 text-sm !text-white focus:border-yellow-300 focus:outline-none focus:ring-0"
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

