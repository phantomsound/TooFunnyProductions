/* =========================================================================
   FILE: frontend/src/lib/SettingsContext.tsx
   -------------------------------------------------------------------------
   Draft/Live context with save draft, pull live, publish, reload and stage.
   ========================================================================= */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

type Stage = "live" | "draft";
type Settings = Record<string, any>;

type Ctx = {
  stage: Stage;
  setStage: (s: Stage) => void;
  settings: Settings | null;         // current stage data (readonly-ish)
  setField: (k: string, v: any) => void; // mutate local working copy
  isDirty: boolean;
  saving: boolean;
  save: () => Promise<void>;         // saves draft only (no-op if stage=live)
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
    setSettings(d || {});
    setInitial(d || {});
  }, []);

  useEffect(() => { load(stage); }, [stage, load]);

  const isDirty = useMemo(() => {
    if (!settings || !initial) return false;
    return JSON.stringify(settings) !== JSON.stringify(initial);
  }, [settings, initial]);

  const setField = (k: string, v: any) => {
    setSettings((prev) => ({ ...(prev || {}), [k]: v }));
  };

  const save = useCallback(async () => {
    if (stage !== "draft" || !settings) return;
    setSaving(true);
    try {
      const r = await fetch(api("/api/settings?stage=draft"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out?.error || "Failed to save draft");
      setSettings(out.data || settings);
      setInitial(out.data || settings);
    } finally {
      setSaving(false);
    }
  }, [settings, stage]);

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
