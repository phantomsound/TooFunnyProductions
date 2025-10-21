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
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-3">{title}</h1>
      <p className="opacity-80 mb-8 whitespace-pre-wrap">{intro}</p>

      <h2 className="text-2xl font-semibold mb-3">Upcoming Shows</h2>
      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        {upcoming.map((e: any, i: number) => (
          <div key={i} className="bg-[#111] rounded p-4">
            <div className="text-lg font-semibold">{e.title}</div>
            <div className="text-sm opacity-80">{e.date} · {e.venue}</div>
            {e.link && (
              <a
                href={e.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block underline text-yellow-400"
              >
                Get Tickets
              </a>
            )}
          </div>
        ))}
        {upcoming.length === 0 && <div className="opacity-70">No upcoming shows yet.</div>}
      </div>

      <h2 className="text-2xl font-semibold mb-3">Past Shows</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {past.map((e: any, i: number) => (
          <div key={i} className="bg-[#111] rounded p-4 opacity-80">
            <div className="text-lg font-semibold">{e.title}</div>
            <div className="text-sm">{e.date} · {e.venue}</div>
          </div>
        ))}
        {past.length === 0 && <div className="opacity-70">No past shows yet.</div>}
      </div>
    </div>
  );
}
