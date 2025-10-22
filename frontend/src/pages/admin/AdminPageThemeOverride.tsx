import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsColorPicker from "./SettingsColorPicker";

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

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Theme overrides</h3>
        <p className="text-sm text-gray-600">
          {usingGlobalTheme
            ? "General Settings currently applies theme colors site-wide. Turn off \"Apply theme colors site-wide\" to enable page-level overrides."
            : `Customize the ${pageName.toLowerCase()} colors without affecting the rest of the site.`}
        </p>
      </div>

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">
          Overrides {overridesActive ? "active" : "follow global colors"}
        </span>
        <button
          type="button"
          onClick={resetOverrides}
          disabled={pickerDisabled || !overridesActive}
          className={`rounded border px-3 py-1 text-sm font-semibold transition ${
            pickerDisabled || !overridesActive
              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
          }`}
        >
          Clear overrides
        </button>
      </div>
    </section>
  );
}
