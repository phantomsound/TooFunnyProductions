import React from "react";
import { useSettings } from "../lib/SettingsContext";

export default function Merch() {
  const { settings } = useSettings();
  const items = Array.isArray(settings?.merch_items) ? settings.merch_items : [];
  // item: { title, price, image_url, buy_url }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-6">{settings?.merch_title || "Merch"}</h1>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((m: any, i: number) => (
          <div key={i} className="bg-[#111] rounded p-4">
            {m.image_url && <img src={m.image_url} alt={m.title} className="w-full h-48 object-cover rounded mb-3" />}
            <div className="text-lg font-semibold">{m.title}</div>
            {m.price && <div className="text-sm opacity-80 mb-2">${m.price}</div>}
            {m.buy_url && (
              <a href={m.buy_url} target="_blank" className="inline-block px-3 py-1 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300">
                Buy
              </a>
            )}
          </div>
        ))}
      </div>

      {items.length === 0 && <div className="opacity-70">No merch items yet.</div>}
    </div>
  );
}
