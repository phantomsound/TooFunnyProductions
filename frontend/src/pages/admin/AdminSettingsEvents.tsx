/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsEvents.tsx
   -------------------------------------------------------------------------
   Admin editor for upcoming & past events listings.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";

type EventEntry = {
  title: string;
  date: string;
  venue: string;
  link: string;
};

type EventsSettings = {
  events_title: string;
  events_intro: string;
  events_upcoming: EventEntry[];
  events_past: EventEntry[];
};

const sanitizeEventList = (value: unknown): EventEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title : "",
        date: typeof obj.date === "string" ? obj.date : "",
        venue: typeof obj.venue === "string" ? obj.venue : "",
        link: typeof obj.link === "string" ? obj.link : "",
      };
    });
};

const sanitize = (raw: unknown): EventsSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    events_title: typeof safe.events_title === "string" ? safe.events_title : "Events",
    events_intro:
      typeof safe.events_intro === "string"
        ? safe.events_intro
        : "Catch Too Funny Productions on stage and on tour.",
    events_upcoming: sanitizeEventList(safe.events_upcoming),
    events_past: sanitizeEventList(safe.events_past),
  };
};

const blankEvent: EventEntry = { title: "", date: "", venue: "", link: "" };

export default function AdminSettingsEvents(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<EventsSettings>(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof EventsSettings>(key: K, value: EventsSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const updateEvent = (list: "events_upcoming" | "events_past", index: number, patch: Partial<EventEntry>) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextList = prev[list].map((event, idx) =>
        idx === index ? { ...event, ...patch } : event
      );
      setField(list, nextList);
      return { ...prev, [list]: nextList } as EventsSettings;
    });
  };

  const addEvent = (list: "events_upcoming" | "events_past") => {
    if (disabled) return;
    const next = [...local[list], { ...blankEvent }];
    setLocal((prev) => ({ ...prev, [list]: next }));
    setField(list, next);
  };

  const removeEvent = (list: "events_upcoming" | "events_past", index: number) => {
    if (disabled) return;
    const next = local[list].filter((_, idx) => idx !== index);
    setLocal((prev) => ({ ...prev, [list]: next }));
    setField(list, next);
  };

  const renderList = (list: "events_upcoming" | "events_past", label: string) => (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{label}</h3>
        <button
          type="button"
          onClick={() => addEvent(list)}
          disabled={disabled}
          className={`rounded px-3 py-2 text-sm font-semibold ${
            disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          Add event
        </button>
      </div>

      {local[list].length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
          No events yet. Use “Add event” to start building the list.
        </p>
      ) : (
        <div className="space-y-4">
          {local[list].map((event, index) => (
            <div key={index} className="rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-semibold">
                  Title
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                    value={event.title}
                    onChange={(e) => updateEvent(list, index, { title: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Date
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                    placeholder="April 1, 2025"
                    value={event.date}
                    onChange={(e) => updateEvent(list, index, { date: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Venue
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                    value={event.venue}
                    onChange={(e) => updateEvent(list, index, { venue: e.target.value })}
                    disabled={disabled}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Ticket Link
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                    placeholder="https://…"
                    value={event.link}
                    onChange={(e) => updateEvent(list, index, { link: e.target.value })}
                    disabled={disabled}
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeEvent(list, index)}
                  disabled={disabled}
                  className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove event
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <label className="block text-sm font-semibold mb-1">Events Page Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.events_title}
            onChange={(event) => updateField("events_title", event.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Intro Paragraph</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[100px]"
            value={local.events_intro}
            onChange={(event) => updateField("events_intro", event.target.value)}
            disabled={disabled}
          />
        </div>
      </section>

      {renderList("events_upcoming", "Upcoming events")}
      {renderList("events_past", "Past events")}
    </div>
  );
}

