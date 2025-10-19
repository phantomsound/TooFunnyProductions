import React from "react";
import { useSettings } from "../lib/SettingsContext";

export default function About() {
  const { settings } = useSettings();
  const team = Array.isArray(settings?.about_team) ? settings.about_team : []; // [{name, title, photo_url, socials:{...}}]

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-6">{settings?.about_title || "About Too Funny"}</h1>
      <p className="opacity-80 mb-10">{settings?.about_body || "We make original sketches, live shows, and more."}</p>

      <h2 className="text-2xl font-semibold mb-4">Meet the Team</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {team.map((m: any, i: number) => (
          <div key={i} className="bg-[#111] rounded-lg p-4">
            {m.photo_url && <img src={m.photo_url} alt={m.name} className="w-full h-48 object-cover rounded mb-3" />}
            <div className="text-lg font-semibold">{m.name}</div>
            <div className="text-sm opacity-80">{m.title}</div>
            {m.socials && (
              <div className="mt-2 flex gap-3 text-sm">
                {m.socials.instagram && (
                  <a href={m.socials.instagram} target="_blank" className="underline">Instagram</a>
                )}
                {m.socials.twitter && (
                  <a href={m.socials.twitter} target="_blank" className="underline">Twitter/X</a>
                )}
                {m.socials.youtube && (
                  <a href={m.socials.youtube} target="_blank" className="underline">YouTube</a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
