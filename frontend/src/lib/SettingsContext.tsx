/* =========================================================================
   FILE: frontend/src/lib/SettingsContext.tsx
   -------------------------------------------------------------------------
   Draft/Live context with save draft, pull live, publish, reload and stage.
   ========================================================================= */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAuth } from "../hooks/useAuth";

const isEventLike = (value: unknown): value is { nativeEvent?: unknown; preventDefault?: () => void } => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  if (typeof maybe.preventDefault === "function") return true;
  if (maybe.nativeEvent) return true;
  if (typeof maybe.stopPropagation === "function") return true;
  if ("target" in maybe && maybe.target && typeof maybe.target === "object") return true;
  return false;
};

const isDomNode = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  if (typeof Node !== "undefined" && value instanceof Node) return true;
  const maybe = value as { nodeType?: unknown; ownerDocument?: unknown; constructor?: { name?: unknown } };
  if (typeof maybe.nodeType === "number" && maybe.nodeType > 0) return true;
  if (maybe.ownerDocument && typeof maybe.ownerDocument === "object") return true;
  const ctorName = typeof maybe.constructor?.name === "string" ? maybe.constructor.name : "";
  return /Element$/i.test(ctorName) || /Node$/i.test(ctorName);
};

const toSerializable = (value: any, seen = new WeakSet<object>()): any => {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (type === "function") return undefined;
  if (isEventLike(value)) return undefined;
  if (typeof File !== "undefined" && value instanceof File) return undefined;
  if (typeof Element !== "undefined" && value instanceof Element) return undefined;
  if (isDomNode(value)) return undefined;

  if (type === "object") {
    if (seen.has(value as object)) return undefined;
    seen.add(value as object);

    if (Array.isArray(value)) {
      const arr: any[] = [];
      for (const entry of value) {
        const serial = toSerializable(entry, seen);
        if (serial !== undefined) arr.push(serial);
      }
      return arr;
    }

    const obj: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      const serial = toSerializable(entry, seen);
      if (serial !== undefined) obj[key] = serial;
    }
    return obj;
  }

  return undefined;
};

const sanitizeSettings = (value: Settings | null | undefined): Settings => {
  if (!value || typeof value !== "object") return {};
  const sanitized = toSerializable(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {};
  return sanitized as Settings;
};

type Stage = "live" | "draft";
type Settings = Record<string, any>;

const DEFAULT_THEME = {
  accent: "#FFD700",
  background: "#050505",
  header: "#000000",
  footer: "#000000",
};

const ensureHex = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!match) return fallback;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return `#${hex.toUpperCase()}`;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = ensureHex(hex, "#000000").slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
};

const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const getReadableText = (hex: string): string => (relativeLuminance(hex) > 0.55 ? "#111111" : "#FFFFFF");

const blend = (base: string, mix: string, weight: number): string => {
  const [r1, g1, b1] = hexToRgb(base);
  const [r2, g2, b2] = hexToRgb(mix);
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  const ratio = Math.min(1, Math.max(0, weight));
  const r = clamp(r1 * (1 - ratio) + r2 * ratio);
  const g = clamp(g1 * (1 - ratio) + g2 * ratio);
  const b = clamp(b1 * (1 - ratio) + b2 * ratio);
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
};

const computeTheme = (settings: Settings | null) => {
  const useGlobal = settings?.theme_use_global !== false;
  const accent = ensureHex(useGlobal ? settings?.theme_accent : null, DEFAULT_THEME.accent);
  const background = ensureHex(useGlobal ? settings?.theme_bg : null, DEFAULT_THEME.background);
  const header = ensureHex(useGlobal ? settings?.header_bg : null, DEFAULT_THEME.header);
  const footer = ensureHex(useGlobal ? settings?.footer_bg : null, DEFAULT_THEME.footer);

  const onAccent = getReadableText(accent);
  const onBackground = getReadableText(background);
  const onHeader = getReadableText(header);
  const onFooter = getReadableText(footer);

  return {
    accent,
    accentHover: blend(accent, onAccent, 0.15),
    accentBorder: blend(accent, background, 0.55),
    accentSoft: blend(background, accent, 0.12),
    accentText: onAccent,
    accentTextSoft: blend(onAccent, background, 0.35),
    background,
    backgroundText: onBackground,
    backgroundTextMuted: blend(onBackground, background, 0.55),
    surface: blend(background, onBackground, 0.08),
    surfaceBorder: blend(onBackground, background, 0.82),
    header,
    headerText: onHeader,
    headerTextMuted: blend(onHeader, header, 0.55),
    footer,
    footerText: onFooter,
    footerTextMuted: blend(onFooter, footer, 0.55),
  };
};

type LockState = {
  holder_email: string | null;
  acquired_at: string | null;
  expires_at: string | null;
} | null;

type AcquireOptions = {
  silent?: boolean;
  ttlSeconds?: number;
};

type ReleaseOptions = {
  silent?: boolean;
};

type Ctx = {
  stage: Stage;
  setStage: (s: Stage) => void;
  settings: Settings | null;         // current stage data (readonly-ish)
  setField: (k: string, v: any) => void; // mutate local working copy
  loading: boolean;
  isDirty: boolean;
  saving: boolean;
  save: (payload?: Partial<Settings>) => Promise<void>; // saves draft only (no-op if stage=live)
  pullLive: () => Promise<void>;     // copies live -> draft and loads it
  publish: () => Promise<void>;      // copies draft -> live and reloads live
  reload: () => Promise<void>;       // reload current stage from server
  lock: LockState;
  hasLock: boolean;
  lockedByOther: boolean;
  lockLoading: boolean;
  lockError: string | null;
  acquireLock: (options?: AcquireOptions) => Promise<boolean>;
  releaseLock: (options?: ReleaseOptions) => Promise<void>;
  refreshLock: () => Promise<void>;
};

const SettingsContext = createContext<Ctx | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const myEmail = user?.email ? user.email.toLowerCase() : null;

  const [stage, setStage] = useState<Stage>("live");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [initial, setInitial] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lock, setLock] = useState<LockState>(null);
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const lockOwner = useMemo(() => {
    if (!lock?.holder_email) return null;
    return String(lock.holder_email).toLowerCase();
  }, [lock?.holder_email]);

  const hasLock = Boolean(lockOwner && myEmail && lockOwner === myEmail);
  const lockedByOther = Boolean(lockOwner && lockOwner !== myEmail);

  const load = useCallback(async (s: Stage) => {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/settings?stage=${s}`), { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      const safe = sanitizeSettings(d || {});
      setSettings(safe);
      setInitial(safe);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(stage); }, [stage, load]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    const fallback = "/favicon.ico";
    const next =
      typeof settings?.favicon_url === "string" && settings.favicon_url.trim().length > 0
        ? settings.favicon_url
        : fallback;
    if (favicon && favicon.href !== next) {
      favicon.href = next;
    }

    const title =
      typeof settings?.site_title === "string" && settings.site_title.trim().length > 0
        ? settings.site_title
        : "Too Funny Productions";
    if (document.title !== title) {
      document.title = title;
    }
  }, [settings?.favicon_url, settings?.site_title]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const theme = computeTheme(settings);
    const root = document.documentElement;
    const setVar = (name: string, value: string) => {
      root.style.setProperty(name, value);
    };

    setVar("--tf-accent", theme.accent);
    setVar("--tf-accent-hover", theme.accentHover);
    setVar("--tf-accent-border", theme.accentBorder);
    setVar("--tf-accent-soft", theme.accentSoft);
    setVar("--tf-accent-text", theme.accentText);
    setVar("--tf-accent-text-soft", theme.accentTextSoft);

    setVar("--tf-bg", theme.background);
    setVar("--tf-on-bg", theme.backgroundText);
    setVar("--tf-on-bg-muted", theme.backgroundTextMuted);
    setVar("--tf-surface", theme.surface);
    setVar("--tf-surface-border", theme.surfaceBorder);

    setVar("--tf-header", theme.header);
    setVar("--tf-on-header", theme.headerText);
    setVar("--tf-on-header-muted", theme.headerTextMuted);

    setVar("--tf-footer", theme.footer);
    setVar("--tf-on-footer", theme.footerText);
    setVar("--tf-on-footer-muted", theme.footerTextMuted);
  }, [settings]);

  const isDirty = useMemo(() => {
    if (!settings || !initial) return false;
    try {
      return JSON.stringify(settings) !== JSON.stringify(initial);
    } catch {
      return true;
    }
  }, [settings, initial]);

  const setField = (k: string, v: any) => {
    if (stage !== "draft" || lockedByOther) return;
    setSettings((prev) => {
      const base = sanitizeSettings(prev || {});
      const nextValue = toSerializable(v);
      if (nextValue === undefined) {
        const { [k]: _omit, ...rest } = base;
        return rest;
      }
      return { ...base, [k]: nextValue };
    });
  };

  const save = useCallback(
    async (incoming?: Partial<Settings>) => {
      if (stage !== "draft" || lockedByOther) return;

      const payload = isEventLike(incoming) ? undefined : incoming;
      const base = sanitizeSettings(settings);
      const next = payload ? { ...base, ...sanitizeSettings(payload as Settings) } : base;

      if (!next || Object.keys(next).length === 0) return;

      // Optimistically update local state so forms stay in sync.
      const safe = sanitizeSettings(next);
      setSettings(safe);

      setSaving(true);
      try {
        const r = await fetch(api("/api/settings?stage=draft"), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(safe),
        });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out?.error || "Failed to save draft");
        const data = out.data && typeof out.data === "object" ? out.data : safe;
        const clean = sanitizeSettings(data);
        setSettings(clean);
        setInitial(clean);
      } finally {
        setSaving(false);
      }
    },
    [settings, stage, lockedByOther]
  );

  const refreshLock = useCallback(async () => {
    if (stage !== "draft") {
      setLock(null);
      setLockError(null);
      return;
    }
    try {
      const response = await fetch(api("/api/settings/lock"), { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          setLock(null);
          setLockError(null);
          return;
        }
        throw new Error(data?.error || "Failed to load lock");
      }
      setLock(data.lock || null);
      setLockError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load lock";
      setLockError(message);
    }
  }, [stage]);

  const acquireLock = useCallback(
    async (options: AcquireOptions = {}) => {
      if (stage !== "draft") return false;
      const { silent = false, ttlSeconds } = options;
      if (!silent) {
        setLockLoading(true);
        setLockError(null);
      }
      try {
        const response = await fetch(api("/api/settings/lock/acquire"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ttlSeconds }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 423) {
            setLock(data.lock || null);
            if (!silent) setLockError(data?.error || "Draft locked by another editor.");
            return false;
          }
          if (response.status === 403) {
            setLock(null);
            if (!silent) setLockError("Admin access required to edit draft.");
            return false;
          }
          throw new Error(data?.error || "Failed to acquire lock");
        }
        setLock(data.lock || null);
        if (!silent) setLockError(null);
        return true;
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : "Failed to acquire lock";
          setLockError(message);
        }
        return false;
      } finally {
        if (!silent) setLockLoading(false);
      }
    },
    [stage]
  );

  const releaseLock = useCallback(
    async (options: ReleaseOptions = {}) => {
      const { silent = false } = options;
      if (!silent) {
        setLockLoading(true);
        setLockError(null);
      }
      try {
        const response = await fetch(api("/api/settings/lock/release"), {
          method: "POST",
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (!silent) setLockError(data?.error || "Failed to release lock");
          setLock(data.lock || null);
          return;
        }
        setLock(null);
        if (!silent) setLockError(null);
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : "Failed to release lock";
          setLockError(message);
        }
      } finally {
        if (!silent) setLockLoading(false);
      }
    },
    []
  );

  const pullLive = useCallback(async () => {
    const previousStage = stage;
    try {
      const r = await fetch(api("/api/settings/pull-live"), { method: "POST", credentials: "include" });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out?.error || "Failed to pull live into draft");
      const data = out.data && typeof out.data === "object" ? out.data : {};
      const clean = sanitizeSettings(data);
      setSettings(clean);
      setInitial(clean);
      setStage("draft");
      await load("draft");
    } catch (error) {
      setStage(previousStage);
      throw error;
    }
  }, [load, stage]);

  const publish = useCallback(async () => {
    const r = await fetch(api("/api/settings/publish"), { method: "POST", credentials: "include" });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out?.error || "Failed to publish");
    // after publish, reload live and switch to live
    await load("live");
    setStage("live");
  }, [load]);

  const reload = useCallback(async () => { await load(stage); }, [stage, load]);

  useEffect(() => {
    if (stage === "draft") {
      acquireLock({ silent: true });
    } else {
      setLock(null);
      setLockError(null);
    }
  }, [stage, acquireLock]);

  useEffect(() => {
    if (stage !== "draft" || !hasLock) return;
    const handle = window.setInterval(() => {
      acquireLock({ silent: true, ttlSeconds: 300 });
    }, 60_000);
    return () => window.clearInterval(handle);
  }, [stage, hasLock, acquireLock]);

  useEffect(() => {
    if (stage !== "draft" || hasLock) return;
    const handle = window.setInterval(() => {
      refreshLock();
    }, 90_000);
    return () => window.clearInterval(handle);
  }, [stage, hasLock, refreshLock]);

  useEffect(() => {
    if (stage === "draft" || !hasLock) return;
    releaseLock({ silent: true }).catch(() => {});
  }, [stage, hasLock, releaseLock]);

  useEffect(() => {
    if (stage === "draft" || !lock) return;
    setLock(null);
    setLockError(null);
  }, [stage, lock]);

  useEffect(() => {
    if (!hasLock) return;
    const handler = () => {
      try {
        const blob = new Blob([JSON.stringify({})], { type: "application/json" });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(api("/api/settings/lock/release"), blob);
        }
      } catch {
        /* no-op */
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasLock]);

  const value = useMemo<Ctx>(
    () => ({
      stage,
      setStage,
      settings,
      setField,
      loading,
      isDirty,
      saving,
      save,
      pullLive,
      publish,
      reload,
      lock,
      hasLock,
      lockedByOther,
      lockLoading,
      lockError,
      acquireLock,
      releaseLock,
      refreshLock,
    }),
    [
      stage,
      settings,
      loading,
      isDirty,
      saving,
      save,
      pullLive,
      publish,
      reload,
      lock,
      hasLock,
      lockedByOther,
      lockLoading,
      lockError,
      acquireLock,
      releaseLock,
      refreshLock,
    ]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
