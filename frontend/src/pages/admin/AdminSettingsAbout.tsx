/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsAbout.tsx
   -------------------------------------------------------------------------
   Admin editor for About page content: mission copy + team members.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsUploader from "./SettingsUploader";

type SocialLinks = {
  instagram?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
  website?: string;
};

type TeamMember = {
  name: string;
  title: string;
  bio: string;
  photo_url: string;
  socials: SocialLinks;
};

type AboutSettings = {
  about_title: string;
  about_body: string;
  about_mission_title: string;
  about_mission_body: string;
  about_team_intro: string;
  about_team: TeamMember[];
};

const sanitizeSocials = (value: unknown): SocialLinks => {
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const socials: SocialLinks = {};
  for (const key of ["instagram", "twitter", "youtube", "tiktok", "website"] as const) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) socials[key] = raw.trim();
  }
  return socials;
};

const sanitizeTeam = (value: unknown): TeamMember[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        name: typeof obj.name === "string" ? obj.name : "",
        title: typeof obj.title === "string" ? obj.title : "",
        bio: typeof obj.bio === "string" ? obj.bio : "",
        photo_url: typeof obj.photo_url === "string" ? obj.photo_url : "",
        socials: sanitizeSocials(obj.socials),
      };
    });
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
    about_team: sanitizeTeam(safe.about_team),
  };
};

const blankMember: TeamMember = {
  name: "",
  title: "",
  bio: "",
  photo_url: "",
  socials: {},
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

  const updateMember = <K extends keyof TeamMember>(index: number, key: K, value: TeamMember[K]) => {
    if (disabled) return;
    let nextTeam: TeamMember[] = [];
    setLocal((prev) => {
      nextTeam = prev.about_team.map((member, idx) =>
        idx === index ? { ...member, [key]: value } : member
      );
      return { ...prev, about_team: nextTeam };
    });
    setField("about_team", nextTeam);
  };

  const updateSocial = (index: number, key: keyof SocialLinks, value: string) => {
    if (disabled) return;
    let nextTeam: TeamMember[] = [];
    setLocal((prev) => {
      nextTeam = prev.about_team.map((member, idx) => {
        if (idx !== index) return member;
        const socials = { ...member.socials };
        if (value.trim()) {
          socials[key] = value.trim();
        } else {
          delete socials[key];
        }
        return { ...member, socials };
      });
      return { ...prev, about_team: nextTeam };
    });
    setField("about_team", nextTeam);
  };

  const addMember = () => {
    if (disabled) return;
    const next = [...local.about_team, { ...blankMember }];
    setLocal((prev) => ({ ...prev, about_team: next }));
    setField("about_team", next);
  };

  const removeMember = (index: number) => {
    if (disabled) return;
    const next = local.about_team.filter((_, idx) => idx !== index);
    setLocal((prev) => ({ ...prev, about_team: next }));
    setField("about_team", next);
  };

  return (
    <div className="space-y-8">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <label className="block text-sm font-semibold mb-1">About Page Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.about_title}
            onChange={(event) => updateField("about_title", event.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Intro Paragraph</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[120px]"
            value={local.about_body}
            onChange={(event) => updateField("about_body", event.target.value)}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Mission</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-semibold">
            Mission Heading
            <input
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-black"
              value={local.about_mission_title}
              onChange={(event) => updateField("about_mission_title", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block text-sm font-semibold">
            Mission Copy
            <textarea
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[100px]"
              value={local.about_mission_body}
              onChange={(event) => updateField("about_mission_body", event.target.value)}
              disabled={disabled}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Team Members</h3>
            <p className="text-sm text-gray-600">
              Introduce the performers and collaborators featured on the About page.
            </p>
          </div>
          <button
            type="button"
            onClick={addMember}
            disabled={disabled}
            className={`self-start rounded px-3 py-2 text-sm font-semibold ${
              disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            Add team member
          </button>
        </div>

        <label className="block text-sm font-semibold">
          Team Intro Blurb
          <textarea
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[80px]"
            value={local.about_team_intro}
            onChange={(event) => updateField("about_team_intro", event.target.value)}
            disabled={disabled}
          />
        </label>

        {local.about_team.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            No team members yet. Use “Add team member” to feature your collaborators.
          </p>
        ) : (
          <div className="space-y-6">
            {local.about_team.map((member, index) => (
              <div key={index} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row">
                  <div className="md:w-1/3">
                    <SettingsUploader
                      label="Portrait"
                      value={member.photo_url}
                      onChange={(url) => updateMember(index, "photo_url", url)}
                      accept="image/*"
                      buttonLabel="Upload portrait"
                      disabled={disabled}
                      pickerKind="image"
                    />
                  </div>

                  <div className="md:flex-1 space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm font-semibold">
                        Name
                        <input
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                          value={member.name}
                          onChange={(event) => updateMember(index, "name", event.target.value)}
                          disabled={disabled}
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Role
                        <input
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                          value={member.title}
                          onChange={(event) => updateMember(index, "title", event.target.value)}
                          disabled={disabled}
                        />
                      </label>
                    </div>

                    <label className="text-sm font-semibold block">
                      Bio
                      <textarea
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black min-h-[80px]"
                        value={member.bio}
                        onChange={(event) => updateMember(index, "bio", event.target.value)}
                        disabled={disabled}
                      />
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      {(["instagram", "twitter", "youtube", "tiktok", "website"] as const).map((network) => (
                        <label key={network} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {network}
                          <input
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-black text-sm"
                            value={member.socials[network] || ""}
                            onChange={(event) => updateSocial(index, network, event.target.value)}
                            disabled={disabled}
                            placeholder={network === "website" ? "https://toofunnyproductions.com" : `https://…/${network}`}
                          />
                        </label>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeMember(index)}
                        disabled={disabled}
                        className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove member
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

