import React from "react";
import { useSettings } from "../lib/SettingsContext";

export default function About() {
  const { settings } = useSettings();
  const title = typeof settings?.about_title === "string" ? settings.about_title : "About Too Funny";
  const body =
    typeof settings?.about_body === "string"
      ? settings.about_body
      : "We make original sketches, live shows, and more.";
  const missionTitle =
    typeof settings?.about_mission_title === "string" ? settings.about_mission_title : "Our Mission";
  const missionBody =
    typeof settings?.about_mission_body === "string"
      ? settings.about_mission_body
      : "Bring people together through original comedy that is Too Funny to forget.";
  const teamIntro =
    typeof settings?.about_team_intro === "string"
      ? settings.about_team_intro
      : "Meet the collaborators bringing the chaos to life.";

  const team = Array.isArray(settings?.about_team) ? settings.about_team : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-6">{title}</h1>
      <p className="opacity-80 mb-10 whitespace-pre-wrap">{body}</p>

      <section className="mb-12 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-semibold mb-2 text-yellow-300">{missionTitle}</h2>
          <p className="opacity-90 whitespace-pre-wrap">{missionBody}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-xl font-semibold mb-2 text-yellow-200">What drives us</h3>
          <p className="opacity-90">
            Too Funny Productions is a collaborative crew of comedians, directors, editors, and techs obsessed with creating
            unforgettable sketch and improv experiences.
          </p>
        </div>
      </section>

      <h2 className="text-2xl font-semibold mb-2">Meet the Team</h2>
      <p className="opacity-75 mb-6 whitespace-pre-wrap">{teamIntro}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {team.map((m: any, i: number) => (
          <div key={i} className="bg-[#111] rounded-lg p-4">
            {m.photo_url && <img src={m.photo_url} alt={m.name} className="w-full h-48 object-cover rounded mb-3" />}
            <div className="text-lg font-semibold">{m.name}</div>
            <div className="text-sm opacity-80">{m.title}</div>
            {m.bio ? <p className="mt-2 text-sm opacity-80 whitespace-pre-wrap">{m.bio}</p> : null}
            {m.socials && (
              <div className="mt-2 flex gap-3 text-sm">
                {Object.entries(m.socials)
                  .filter(([, url]) => typeof url === "string" && url)
                  .map(([network, url]: [string, string]) => (
                    <a key={network} href={url} target="_blank" rel="noopener noreferrer" className="underline">
                      {network.charAt(0).toUpperCase() + network.slice(1)}
                    </a>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
