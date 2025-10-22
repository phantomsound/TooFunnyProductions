export const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const sanitizeInput = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return trimmed;
  return `#${trimmed}`;
};

const expandShorthand = (value: string): string => {
  if (value.length !== 4) return value;
  return `#${value
    .slice(1)
    .split("")
    .map((char) => char + char)
    .join("")}`;
};

export const isValidHex = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  return HEX_PATTERN.test(value.trim());
};

const normalizeFallback = (fallback: string): string => {
  if (isValidHex(fallback)) {
    return expandShorthand(sanitizeInput(fallback).toUpperCase());
  }
  return "#000000";
};

export const normalizeHex = (value: unknown, fallback = "#000000"): string => {
  const safeFallback = normalizeFallback(fallback);
  if (!isValidHex(value)) return safeFallback;
  const withHash = sanitizeInput(String(value).toUpperCase());
  const cleaned = `#${withHash
    .slice(1)
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 6)}`;
  if (HEX_PATTERN.test(cleaned)) {
    return expandShorthand(cleaned);
  }
  return safeFallback;
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = normalizeHex(hex, "#000000");
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
};

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (foreground: string, background: string): number => {
  const lumA = relativeLuminance(foreground);
  const lumB = relativeLuminance(background);
  const light = Math.max(lumA, lumB);
  const dark = Math.min(lumA, lumB);
  const ratio = (light + 0.05) / (dark + 0.05);
  return Math.round(ratio * 100) / 100;
};

export const pickTextColor = (hex: string, light = "#FFFFFF", dark = "#111111"): string => {
  const luminance = relativeLuminance(hex);
  return luminance > 0.55 ? dark : light;
};

const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

export const blendColors = (base: string, mix: string, weight: number): string => {
  const ratio = Math.min(1, Math.max(0, weight));
  const [r1, g1, b1] = hexToRgb(base);
  const [r2, g2, b2] = hexToRgb(mix);
  const r = clamp(r1 * (1 - ratio) + r2 * ratio);
  const g = clamp(g1 * (1 - ratio) + g2 * ratio);
  const b = clamp(b1 * (1 - ratio) + b2 * ratio);
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
};

export const lighten = (hex: string, amount: number) => blendColors(hex, "#FFFFFF", amount);
export const darken = (hex: string, amount: number) => blendColors(hex, "#000000", amount);
