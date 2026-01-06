/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsAbout.tsx
   -------------------------------------------------------------------------
   Admin editor for About page content: mission copy + intro text.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import AdminPageThemeOverride from "./AdminPageThemeOverride";

type AboutSettings = {
  about_title: string;
  about_body: string;
  about_mission_title: string;
  about_mission_body: string;
  about_team_intro: string;
};

const sanitize = (raw: unknown): AboutSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    about_title: typeof safe.about_title === "string" ? safe.about_title : "About Too Funny",
    about_body:
      typeof safe.about_body === "string"
        ? safe.about_body
        : "We’re a collective of comedians, directors, editors, and techs building high-energy sketch and improv shows.",
    about_mission_title:
      typeof safe.about_mission_title === "string" ? safe.about_mission_title : "Our Mission",
    about_mission_body:
      typeof safe.about_mission_body === "string"
        ? safe.about_mission_body
        : "Bring people together through original comedy that is Too Funny to forget.",
    about_team_intro:
      typeof safe.about_team_intro === "string"
        ? safe.about_team_intro
        : "Meet the collaborators bringing the chaos to life.",
  };
};

export default function AdminSettingsAbout(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<AboutSettings>(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof AboutSettings>(key: K, value: AboutSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">About title</label>
            <input
              value={local.about_title}
              onChange={(e) => updateField("about_title", e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">About body</label>
            <textarea
              value={local.about_body}
              onChange={(e) => updateField("about_body", e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2"
              rows={5}
            />
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Mission title</label>
            <input
              value={local.about_mission_title}
              onChange={(e) => updateField("about_mission_title", e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Mission body</label>
            <textarea
              value={local.about_mission_body}
              onChange={(e) => updateField("about_mission_body", e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2"
              rows={5}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Team intro copy</label>
            <textarea
              value={local.about_team_intro}
              onChange={(e) => updateField("about_team_intro", e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2"
              rows={3}
            />
            <p className="mt-2 text-xs text-neutral-500">
              Team members are managed in the <span className="font-semibold">People</span> tab.
            </p>
          </div>
        </div>
      </div>

      <AdminPageThemeOverride prefix="about" pageName="About" />
    </div>
  );
}
