import React, { useEffect, useMemo, useRef, useState } from "react";

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

const sliderToHex = (base: string, offset: number): string => {
  if (offset === 0) return base;
  const normalized = Math.min(40, Math.max(-40, offset));
  const amount = Math.abs(normalized) / 100;
  return normalized > 0 ? lighten(base, amount) : darken(base, amount);
};

export default function SettingsColorPicker({
  label,
  value,
  onChange,
  disabled = false,
}: SettingsColorPickerProps): JSX.Element {
  const normalizedValue = useMemo(() => normalizeHex(value, "#000000"), [value]);
  const [inputValue, setInputValue] = useState(normalizedValue);
  const [toneOffset, setToneOffset] = useState(0);
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);

  const sliderActiveRef = useRef(false);
  const sliderBaseRef = useRef(normalizedValue);
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      sliderBaseRef.current = normalizedValue;
      return;
    }
    setInputValue(normalizedValue);
    setToneOffset(0);
    setTouched(false);
    sliderBaseRef.current = normalizedValue;
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

  const applyColor = (hex: string, { fromSlider = false }: { fromSlider?: boolean } = {}) => {
    const normalized = normalizeHex(hex, normalizedValue);
    setInputValue(normalized);
    onChange(normalized);
    if (fromSlider) {
      skipSyncRef.current = true;
    }
  };

  const handleColorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextHex = normalizeHex(event.target.value, appliedHex);
    setToneOffset(0);
    sliderBaseRef.current = nextHex;
    applyColor(nextHex);
  };

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeHexInput(event.target.value);
    setInputValue(sanitized);
    if (isValidHex(sanitized)) {
      const normalized = normalizeHex(sanitized, normalizedValue);
      setToneOffset(0);
      sliderBaseRef.current = normalized;
      applyColor(normalized);
    }
  };

  const handleBlur = () => {
    setTouched(true);
    if (!hasValidInput) {
      setInputValue(normalizedValue);
      setToneOffset(0);
      sliderBaseRef.current = normalizedValue;
    }
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

  const handleToneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const offset = Number(event.target.value);
    if (!sliderActiveRef.current) {
      sliderActiveRef.current = true;
      sliderBaseRef.current = normalizedValue;
    }
    setToneOffset(offset);
    const nextHex = sliderToHex(sliderBaseRef.current, offset);
    applyColor(nextHex, { fromSlider: true });
  };

  const endSliderInteraction = () => {
    sliderActiveRef.current = false;
    sliderBaseRef.current = normalizeHex(inputValue, normalizedValue);
  };

  return (
    <div
      className={`flex h-full flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-neutral-100 shadow-sm transition ${
        disabled ? "opacity-60" : "hover:border-yellow-400/60"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-2 sm:w-28">
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
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-neutral-400">
          <span>Brightness</span>
          <span className="text-neutral-300">{toneOffset > 0 ? `+${toneOffset}` : toneOffset}</span>
        </div>
        <input
          type="range"
          min={-40}
          max={40}
          step={1}
          value={toneOffset}
          onChange={handleToneChange}
          onMouseDown={() => {
            sliderActiveRef.current = true;
            sliderBaseRef.current = normalizedValue;
          }}
          onTouchStart={() => {
            sliderActiveRef.current = true;
            sliderBaseRef.current = normalizedValue;
          }}
          onMouseUp={endSliderInteraction}
          onTouchEnd={endSliderInteraction}
          onKeyUp={endSliderInteraction}
          disabled={disabled}
          className="mt-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-yellow-300"
          aria-label={`${label} brightness`}
        />
        <div className="mt-1 flex justify-between text-[11px] uppercase tracking-wide text-neutral-500">
          <span>Darker</span>
          <span>Original</span>
          <span>Lighter</span>
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
