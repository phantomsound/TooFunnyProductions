import React from "react";
import { useSettings } from "../lib/SettingsContext";

export default function Events() {
  const { settings } = useSettings();
  const upcoming = Array.isArray(settings?.events_upcoming) ? settings.events_upcoming : []; // [{title,date,venue,link}]
  const past = Array.isArray(settings?.events_past) ? settings.events_past : [];             // same shape
  const title = typeof settings?.events_title === "string" ? settings.events_title : "Events";
  const intro =
    typeof settings?.events_intro === "string"
      ? settings.events_intro
      : "Here’s where you can catch Too Funny Productions next.";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 text-theme-base sm:px-6 sm:py-12 lg:px-8">
      <h1 className="mb-3 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-8 whitespace-pre-wrap break-words text-theme-muted">{intro}</p>

      <h2 className="mb-3 text-2xl font-semibold text-theme-accent">Upcoming Shows</h2>
      <div className="mb-10 grid gap-4 sm:grid-cols-2">
        {upcoming.map((e: any, i: number) => (
          <div key={i} className="rounded border border-theme-surface bg-theme-surface p-4">
            <div className="text-lg font-semibold text-theme-base">{e.title}</div>
            <div className="text-sm text-theme-muted break-words">{e.date} · {e.venue}</div>
            {e.link && (
              <a
                href={e.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block break-words text-theme-accent hover:text-theme-accent"
              >
                Get Tickets
              </a>
            )}
          </div>
        ))}
        {upcoming.length === 0 && <div className="text-theme-muted">No upcoming shows yet.</div>}
      </div>

      <h2 className="mb-3 text-2xl font-semibold text-theme-accent">Past Shows</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {past.map((e: any, i: number) => (
          <div key={i} className="rounded border border-theme-surface bg-theme-surface p-4 text-theme-muted">
            <div className="text-lg font-semibold text-theme-base">{e.title}</div>
            <div className="text-sm break-words">{e.date} · {e.venue}</div>
          </div>
        ))}
        {past.length === 0 && <div className="text-theme-muted">No past shows yet.</div>}
      </div>
    </div>
  );
}
