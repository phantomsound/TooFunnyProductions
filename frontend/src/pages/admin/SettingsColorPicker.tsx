import React, { useEffect, useMemo, useState } from "react";
import {
  blendColors,
  contrastRatio,
  darken,
  isValidHex,
  lighten,
  normalizeHex,
  pickTextColor,
} from "../../lib/color";

const sanitizeHexInput = (raw: string): string => {
  let value = raw.toUpperCase();
  if (!value.startsWith("#")) {
    value = `#${value}`;
  }
  value = `#${value
    .slice(1)
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 6)}`;
  return value;
};

type SettingsColorPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const contrastLabel = (ratio: number): { label: string; tone: "good" | "ok" | "bad" } => {
  if (ratio >= 7) return { label: "AAA", tone: "good" };
  if (ratio >= 4.5) return { label: "AA", tone: "good" };
  if (ratio >= 3) return { label: "AA (large)", tone: "ok" };
  return { label: "Low", tone: "bad" };
};

const toneClass = (tone: "good" | "ok" | "bad") => {
  if (tone === "good") return "text-emerald-300";
  if (tone === "ok") return "text-amber-300";
  return "text-red-300";
};

const quickAdjustments = (hex: string) => [
  { label: "Current", value: hex },
  { label: "Lighter", value: lighten(hex, 0.18) },
  { label: "Bolder", value: darken(hex, 0.18) },
  { label: "Soft", value: blendColors(hex, "#444444", 0.25) },
  { label: "High Contrast", value: blendColors(hex, "#FFFFFF", 0.35) },
];

export default function SettingsColorPicker({
  label,
  value,
  onChange,
  disabled = false,
}: SettingsColorPickerProps): JSX.Element {
  const normalizedValue = useMemo(() => normalizeHex(value, "#000000"), [value]);
  const [inputValue, setInputValue] = useState(normalizedValue);
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setInputValue(normalizedValue);
    setTouched(false);
  }, [normalizedValue]);

  const hasValidInput = useMemo(() => isValidHex(inputValue), [inputValue]);
  const appliedHex = useMemo(
    () => (hasValidInput ? normalizeHex(inputValue, normalizedValue) : normalizedValue),
    [hasValidInput, inputValue, normalizedValue]
  );
  const previewText = useMemo(() => pickTextColor(appliedHex), [appliedHex]);
  const previewSurface = useMemo(() => blendColors(appliedHex, previewText, 0.85), [appliedHex, previewText]);
  const previewSurfaceText = useMemo(() => pickTextColor(previewSurface), [previewSurface]);
  const contrast = useMemo(() => contrastRatio(appliedHex, previewText), [appliedHex, previewText]);
  const { label: contrastTag, tone } = useMemo(() => contrastLabel(contrast), [contrast]);
  const adjustments = useMemo(() => quickAdjustments(appliedHex), [appliedHex]);
  const tonalScale = useMemo(() => {
    const steps = [
      { amount: -0.4, label: "Deep" },
      { amount: -0.25, label: "Shadow" },
      { amount: -0.1, label: "Muted" },
      { amount: 0, label: "Base" },
      { amount: 0.12, label: "Bright" },
      { amount: 0.25, label: "Glow" },
      { amount: 0.4, label: "Soft" },
    ];
    return steps.map(({ amount, label }) => {
      const value = amount === 0
        ? appliedHex
        : amount > 0
        ? lighten(appliedHex, amount)
        : darken(appliedHex, Math.abs(amount));
      return { label, value, text: pickTextColor(value) };
    });
  }, [appliedHex]);

  const handleColorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextHex = normalizeHex(event.target.value, appliedHex);
    setInputValue(nextHex);
    onChange(nextHex);
  };

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeHexInput(event.target.value);
    setInputValue(sanitized);
    if (isValidHex(sanitized)) {
      onChange(normalizeHex(sanitized, normalizedValue));
    }
  };

  const handleBlur = () => {
    setTouched(true);
    if (!hasValidInput) {
      setInputValue(normalizedValue);
    }
  };

  const handleSwatch = (hex: string) => {
    if (disabled) return;
    const normalized = normalizeHex(hex, normalizedValue);
    setInputValue(normalized);
    onChange(normalized);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(appliedHex);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`flex h-full flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900/80 p-4 text-neutral-100 shadow-sm transition ${
        disabled ? "opacity-60" : "hover:border-yellow-400/60"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-2">
          <label className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{label}</label>
          <input
            type="color"
            value={appliedHex}
            onChange={handleColorChange}
            className="h-14 w-20 cursor-pointer rounded border border-neutral-700 bg-neutral-950 shadow"
            disabled={disabled}
            aria-label={label}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-400">Hex value</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={handleTextChange}
              onBlur={handleBlur}
              disabled={disabled}
              className="w-full rounded border border-neutral-700 !bg-neutral-950 px-3 py-2 font-mono text-sm uppercase tracking-wider !text-white shadow-sm focus:border-yellow-300 focus:outline-none"
              placeholder="#000000"
              inputMode="text"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={disabled}
              className="inline-flex items-center rounded border border-neutral-700 px-2.5 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-200 transition hover:border-yellow-300 hover:text-yellow-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Copy
            </button>
          </div>
          {touched && !hasValidInput ? (
            <p className="mt-1 text-xs text-red-400">Enter a 3- or 6-digit hex value such as #FFAA00.</p>
          ) : copied ? (
            <p className="mt-1 text-xs text-emerald-300">Copied to clipboard.</p>
          ) : null}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Quick adjustments</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {adjustments.map((option) => (
            <button
              key={`${option.label}-${option.value}`}
              type="button"
              className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950/60 px-2 py-1 text-xs font-semibold shadow-sm transition hover:border-yellow-300 hover:text-yellow-200 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={() => handleSwatch(option.value)}
              disabled={disabled}
            >
              <span
                className="h-5 w-5 rounded border border-white/10 shadow-inner"
                style={{ backgroundColor: option.value }}
                aria-hidden
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Tonal palette</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tonalScale.map((tone) => (
            <button
              key={`${tone.label}-${tone.value}`}
              type="button"
              onClick={() => handleSwatch(tone.value)}
              disabled={disabled}
              className="flex items-center gap-2 rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold shadow-sm transition hover:border-yellow-300 hover:text-yellow-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded border border-white/10"
                style={{ backgroundColor: tone.value, color: tone.text }}
              >
                ●
              </span>
              <span className="capitalize">{tone.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60">
        <div className="border-b border-neutral-800 bg-neutral-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Preview
        </div>
        <div className="space-y-3 px-4 pb-4 pt-3" style={{ backgroundColor: previewSurface, color: previewSurfaceText }}>
          <div
            className="inline-flex rounded-md px-3 py-2 text-sm font-semibold shadow-sm"
            style={{ backgroundColor: appliedHex, color: previewText }}
          >
            Accent button
          </div>
          <p className="text-xs">
            Sample text on this color has <span className="font-semibold text-yellow-200">{contrastTag}</span> contrast.
          </p>
        </div>
        <div className="border-t border-neutral-800 px-3 py-2 text-xs text-neutral-300">
          Contrast ratio with auto text color: {" "}
          <span className={`font-semibold ${toneClass(tone)}`}>{contrast.toFixed(2)}:1</span> ({contrastTag})
        </div>
      </div>
    </div>
  );
}
