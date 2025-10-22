import React from "react";
import { useSettings } from "../lib/SettingsContext";

export default function Merch() {
  const { settings } = useSettings();
  const items = Array.isArray(settings?.merch_items) ? settings.merch_items : [];
  const title = typeof settings?.merch_title === "string" ? settings.merch_title : "Merch";
  const intro =
    typeof settings?.merch_intro === "string"
      ? settings.merch_intro
      : "Shop the Too Funny Productions collection.";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 text-theme-base">
      <h1 className="mb-3 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-8 whitespace-pre-wrap text-theme-muted">{intro}</p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m: any, i: number) => (
          <div key={i} className="rounded border border-theme-surface bg-theme-surface p-4">
            {m.image_url && (
              <img src={m.image_url} alt={m.title} className="mb-3 h-48 w-full rounded object-cover" />
            )}
            <div className="text-lg font-semibold text-theme-base">{m.title}</div>
            {m.price && <div className="mb-2 text-sm text-theme-muted">${m.price}</div>}
            {m.description ? (
              <p className="mb-3 text-sm text-theme-muted whitespace-pre-wrap">{m.description}</p>
            ) : null}
            {m.buy_url && (
              <a
                href={m.buy_url}
                target="_blank"
                rel="noopener noreferrer"
                className="theme-accent-button inline-block rounded px-3 py-1 text-sm font-semibold transition"
              >
                Buy
              </a>
            )}
          </div>
        ))}
      </div>

      {items.length === 0 && <div className="text-theme-muted">No merch items yet.</div>}
    </div>
  );
}
