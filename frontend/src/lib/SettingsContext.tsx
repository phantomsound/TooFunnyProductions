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

const toSerializable = (value: any, seen = new WeakMap<object, any>()): any => {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (type === "function") return undefined;
  if (isEventLike(value)) return undefined;
  if (typeof File !== "undefined" && value instanceof File) return undefined;
  if (typeof Element !== "undefined" && value instanceof Element) return undefined;

  if (type === "object") {
    if (seen.has(value as object)) return seen.get(value as object);

    if (Array.isArray(value)) {
      const arr: any[] = [];
      seen.set(value, arr);
      for (const entry of value) {
        const serial = toSerializable(entry, seen);
        if (serial !== undefined) arr.push(serial);
      }
      return arr;
    }

    const obj: Record<string, any> = {};
    seen.set(value, obj);
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
    return JSON.stringify(settings) !== JSON.stringify(initial);
  }, [settings, initial]);

  const setField = (k: string, v: any) => {
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
      if (stage !== "draft") return;

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
    [settings, stage]
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
