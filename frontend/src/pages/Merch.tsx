import React from "react";
import { useSettings } from "../lib/SettingsContext";
import { resolveMediaUrl } from "../utils/media";

export default function Merch() {
  const { settings } = useSettings();
  const items = Array.isArray(settings?.merch_items) ? settings.merch_items : [];
  const title = typeof settings?.merch_title === "string" ? settings.merch_title : "Merch";
  const intro =
    typeof settings?.merch_intro === "string"
      ? settings.merch_intro
      : "Shop the Too Funny Productions collection.";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 text-theme-base sm:px-6 sm:py-12 lg:px-8">
      <h1 className="mb-3 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-8 whitespace-pre-wrap break-words text-theme-muted">{intro}</p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m: any, i: number) => {
          const imageUrl = resolveMediaUrl(m?.image_url);
          const hasImage = Boolean(imageUrl);

          return (
            <div key={i} className="rounded border border-theme-surface bg-theme-surface p-4">
              {hasImage ? (
                <img src={imageUrl} alt={m?.title || "Merch item"} className="mb-3 h-48 w-full rounded object-cover" />
              ) : (
                <div className="mb-3 flex h-48 w-full items-center justify-center rounded bg-theme-background text-xs text-theme-muted">
                  Add an image to showcase this item.
                </div>
              )}
            <div className="text-lg font-semibold text-theme-base">{m.title}</div>
            {m.price && <div className="mb-2 text-sm text-theme-muted">${m.price}</div>}
            {m.description ? (
              <p className="mb-3 whitespace-pre-wrap break-words text-sm text-theme-muted">{m.description}</p>
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
          );
        })}
      </div>

      {items.length === 0 && <div className="text-theme-muted">No merch items yet.</div>}
    </div>
  );
}
