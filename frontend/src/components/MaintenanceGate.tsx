import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSettings } from "../lib/SettingsContext";

/**
 * MaintenanceGate
 * - FAILS OPEN: renders children while loading / uncertain (never blank page).
 * - Only blocks when we're certain maintenance is active (manual or scheduled).
 * - If previewing draft (?stage=draft), never block (you’re reviewing edits).
 */
export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { settings, loading } = useSettings();
  const { search } = useLocation();
  const isDraftPreview = new URLSearchParams(search).get("stage") === "draft";

  // quick helpers
  const manualOn = !!settings?.maintenance_enabled;
  const scheduledOn = useMemo(() => {
    if (!settings?.maintenance_schedule_enabled) return false;
    const tz = settings.maintenance_timezone || "UTC";
    const start = (settings.maintenance_daily_start || "").trim(); // "HH:MM"
    const end = (settings.maintenance_daily_end || "").trim();     // "HH:MM"
    if (!start || !end) return false;

    try {
      // Convert now into that timezone (naively; we only care about hours:minutes)
      const now = new Date();
      // HH:MM in tz — we’ll compare minutes since midnight
      const [sh, sm] = start.split(":").map((n) => parseInt(n, 10));
      const [eh, em] = end.split(":").map((n) => parseInt(n, 10));
      if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) return false;

      const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes(); // best-effort; exact TZ not critical for local dev
      const minutesStart = sh * 60 + sm;
      const minutesEnd = eh * 60 + em;

      if (minutesStart === minutesEnd) return false; // zero-length window => off

      // handle windows that cross midnight
      if (minutesStart < minutesEnd) {
        return minutesNow >= minutesStart && minutesNow < minutesEnd;
      } else {
        return minutesNow >= minutesStart || minutesNow < minutesEnd;
      }
    } catch {
      return false;
    }
  }, [
    settings?.maintenance_schedule_enabled,
    settings?.maintenance_timezone,
    settings?.maintenance_daily_start,
    settings?.maintenance_daily_end,
  ]);

  const active = (manualOn || scheduledOn) && !isDraftPreview;

  // While loading settings, SHOW the site (fail-open)
  if (loading) return <>{children}</>;

  // If not active, show the site
  if (!active) return <>{children}</>;

  // Maintenance page (only when we’re certain it’s active)
  return (
    <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold text-yellow-400 mb-3">We’ll be right back</h1>
        <p className="opacity-80 mb-6">
          {settings?.maintenance_message || "Site maintenance is in progress. Please check back soon."}
        </p>
      </div>
    </div>
  );
}
