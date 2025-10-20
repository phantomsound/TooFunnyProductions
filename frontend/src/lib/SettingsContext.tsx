/* =========================================================================
   FILE: frontend/src/lib/SettingsContext.tsx
   -------------------------------------------------------------------------
   Draft/Live context with save draft, pull live, publish, reload and stage.
   ========================================================================= */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const isEventLike = (value: unknown): value is { nativeEvent?: unknown; preventDefault?: () => void } => {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  if (typeof maybe.preventDefault === "function") return true;
  if (maybe.nativeEvent) return true;
  if (typeof maybe.stopPropagation === "function") return true;
  if ("target" in maybe && maybe.target && typeof maybe.target === "object") return true;
  return false;
};

const sanitizeValue = (value: any, seen: WeakSet<object>): any => {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (type === "function") return undefined;
  if (typeof File !== "undefined" && value instanceof File) return undefined;
  if (typeof Element !== "undefined" && value instanceof Element) return undefined;
  if (isEventLike(value)) return undefined;

  if (type === "object") {
    if (seen.has(value)) return undefined;
    seen.add(value);

    if (Array.isArray(value)) {
      const next: any[] = [];
      for (const entry of value) {
        const sanitized = sanitizeValue(entry, seen);
        if (sanitized !== undefined) next.push(sanitized);
      }
      return next;
    }

    const next: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      const sanitized = sanitizeValue(entry, seen);
      if (sanitized !== undefined) next[key] = sanitized;
    }
    return next;
  }

  return undefined;
};

const sanitizeSettings = (value: Settings | null | undefined): Settings => {
  if (!value || typeof value !== "object") return {};
  const sanitized = sanitizeValue(value, new WeakSet<object>());
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {};
  return sanitized as Settings;
};

const jsonSafeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "function") return undefined;
    if (val && typeof val === "object") {
      if (isEventLike(val)) return undefined;
      if (typeof File !== "undefined" && val instanceof File) return undefined;
      if (typeof Element !== "undefined" && val instanceof Element) return undefined;
      if (seen.has(val)) return undefined;
      seen.add(val);
    }
    return val;
  });
};

type Stage = "live" | "draft";
type Settings = Record<string, any>;

type Ctx = {
  stage: Stage;
  setStage: (s: Stage) => void;
  settings: Settings | null;         // current stage data (readonly-ish)
  setField: (k: string, v: any) => void; // mutate local working copy
  isDirty: boolean;
  saving: boolean;
  save: (payload?: Partial<Settings>) => Promise<void>; // saves draft only (no-op if stage=live)
  pullLive: () => Promise<void>;     // copies live -> draft and loads it
  publish: () => Promise<void>;      // copies draft -> live and reloads live
  reload: () => Promise<void>;       // reload current stage from server
};

const SettingsContext = createContext<Ctx | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<Stage>("live");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [initial, setInitial] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (s: Stage) => {
    const r = await fetch(api(`/api/settings?stage=${s}`), { credentials: "include" });
    const d = await r.json().catch(() => ({}));
    const safe = sanitizeSettings(d || {});
    setSettings(safe);
    setInitial(safe);
  }, []);

  useEffect(() => { load(stage); }, [stage, load]);

  const isDirty = useMemo(() => {
    if (!settings || !initial) return false;
    try {
      return JSON.stringify(settings) !== JSON.stringify(initial);
    } catch {
      return true;
    }
  }, [settings, initial]);

  const setField = (k: string, v: any) => {
    setSettings((prev) => {
      const base = sanitizeSettings(prev || {});
      return { ...base, [k]: sanitizeValue(v, new WeakSet<object>()) };
    });
  };

  const save = useCallback(
    async (payload?: Partial<Settings>) => {
      if (stage !== "draft") return;

      setSettings((prev) => {
        if (!prev && !payload) return prev;
        if (!prev) return { ...(payload || {}) };
        if (!payload) return prev;
        return { ...prev, ...payload };
      });

      const next = (() => {
        const base = settings || {};
        return payload ? { ...base, ...payload } : base;
      })();

      if (!next || Object.keys(next).length === 0) return;
      setSaving(true);
      try {
        const r = await fetch(api("/api/settings?stage=draft"), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out?.error || "Failed to save draft");
        const data = out.data || next;
        setSettings(data);
        setInitial(data);
      } finally {
        setSaving(false);
      }
    },
    [settings, stage]
  );

  const pullLive = useCallback(async () => {
    const r = await fetch(api("/api/settings/pull-live"), { method: "POST", credentials: "include" });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out?.error || "Failed to pull live into draft");
    setStage("draft");
    setSettings(out.data || {});
    setInitial(out.data || {});
  }, []);

  const publish = useCallback(async () => {
    const r = await fetch(api("/api/settings/publish"), { method: "POST", credentials: "include" });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out?.error || "Failed to publish");
    // after publish, reload live and switch to live
    await load("live");
    setStage("live");
  }, [load]);

  const reload = useCallback(async () => { await load(stage); }, [stage, load]);

  const value = useMemo<Ctx>(
    () => ({ stage, setStage, settings, setField, isDirty, saving, save, pullLive, publish, reload }),
    [stage, settings, isDirty, saving, save, pullLive, publish, reload]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
