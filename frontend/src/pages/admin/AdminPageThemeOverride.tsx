import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsColorPicker from "./SettingsColorPicker";
import CollapsibleSection from "../../components/CollapsibleSection";

type Props = {
  prefix: string;
  pageName: string;
};

const DEFAULTS = {
  accent: "#FFD700",
  background: "#111111",
  header: "#000000",
  footer: "#000000",
};

const coerceColor = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export default function AdminPageThemeOverride({ prefix, pageName }: Props): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const usingGlobalTheme = (settings as Record<string, unknown> | null)?.theme_use_global !== false;

  const fallback = useMemo(() => {
    const source = (settings || {}) as Record<string, unknown>;
    return {
      accent: coerceColor(source.theme_accent, DEFAULTS.accent),
      background: coerceColor(source.theme_bg, DEFAULTS.background),
      header: coerceColor(source.header_bg, DEFAULTS.header),
      footer: coerceColor(source.footer_bg, DEFAULTS.footer),
    };
  }, [settings]);

  const keys = useMemo(
    () => ({
      accent: `${prefix}_theme_accent`,
      background: `${prefix}_theme_bg`,
      header: `${prefix}_header_bg`,
      footer: `${prefix}_footer_bg`,
    }),
    [prefix]
  );

  const safe = useMemo(() => {
    const source = (settings || {}) as Record<string, unknown>;
    return {
      accent: coerceColor(source[keys.accent], fallback.accent),
      background: coerceColor(source[keys.background], fallback.background),
      header: coerceColor(source[keys.header], fallback.header),
      footer: coerceColor(source[keys.footer], fallback.footer),
    };
  }, [settings, keys, fallback]);

  const [local, setLocal] = useState(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const disabled = stage !== "draft" || lockedByOther;
  const pickerDisabled = disabled || usingGlobalTheme;

  const update = (key: keyof typeof local, value: string) => {
    if (pickerDisabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(keys[key], value);
  };

  const resetOverrides = () => {
    if (pickerDisabled) return;
    (Object.keys(keys) as (keyof typeof keys)[]).forEach((slot) => {
      setField(keys[slot], undefined);
    });
  };

  const overridesActive = useMemo(() => {
    const source = (settings || {}) as Record<string, unknown>;
    return (
      typeof source[keys.accent] === "string" ||
      typeof source[keys.background] === "string" ||
      typeof source[keys.header] === "string" ||
      typeof source[keys.footer] === "string"
    );
  }, [settings, keys]);

  const statusLabel = usingGlobalTheme
    ? "Following global"
    : overridesActive
    ? "Overrides active"
    : "Using defaults";

  const statusClasses = usingGlobalTheme
    ? "border-neutral-700 bg-neutral-900/70 text-neutral-300"
    : overridesActive
    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
    : "border-neutral-700 bg-neutral-900/70 text-neutral-200";

  return (
    <CollapsibleSection
      title={`${pageName} theme overrides`}
      description="Keep this page on-brand without impacting other sections."
      defaultOpen={!usingGlobalTheme && overridesActive}
      headerActions={
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${statusClasses}`}>
          {statusLabel}
        </span>
      }
    >
      {usingGlobalTheme ? (
        <p className="text-sm text-neutral-400">
          General settings currently apply theme colors site-wide. Turn off the {" "}
          <span className="font-semibold text-yellow-200">Apply site-wide</span> toggle to enable page-level overrides.
        </p>
      ) : (
        <p className="text-sm text-neutral-300">
          Customize the {pageName.toLowerCase()} colors without affecting the rest of the site.
        </p>
      )}

      <div className={`grid gap-6 md:grid-cols-2 ${pickerDisabled ? "opacity-60" : ""}`}>
        <SettingsColorPicker
          label="Accent color"
          value={local.accent}
          onChange={(value) => update("accent", value)}
          disabled={pickerDisabled}
        />
        <SettingsColorPicker
          label="Background color"
          value={local.background}
          onChange={(value) => update("background", value)}
          disabled={pickerDisabled}
        />
        <SettingsColorPicker
          label="Header color"
          value={local.header}
          onChange={(value) => update("header", value)}
          disabled={pickerDisabled}
        />
        <SettingsColorPicker
          label="Footer color"
          value={local.footer}
          onChange={(value) => update("footer", value)}
          disabled={pickerDisabled}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-neutral-400">
        <span>
          Overrides {overridesActive ? "active" : "follow global colors"}
        </span>
        <button
          type="button"
          onClick={resetOverrides}
          disabled={pickerDisabled || !overridesActive}
          className={`rounded border px-3 py-1 text-sm font-semibold transition ${
            pickerDisabled || !overridesActive
              ? "cursor-not-allowed border-neutral-800 bg-neutral-900/60 text-neutral-600"
              : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-yellow-300 hover:text-yellow-200"
          }`}
        >
          Clear overrides
        </button>
      </div>
    </CollapsibleSection>
  );
}
