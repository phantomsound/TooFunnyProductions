/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsAbout.tsx
   -------------------------------------------------------------------------
   Admin editor for About page content: mission copy + team members.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsUploader from "./SettingsUploader";
import { normalizeAdminUrl } from "../../utils/url";
import AdminPageThemeOverride from "./AdminPageThemeOverride";

type SocialLink = {
  label: string;
  url: string;
};

type TeamMember = {
  name: string;
  title: string;
  bio: string;
  photo_url: string;
  socials: SocialLink[];
};

type AboutSettings = {
  about_title: string;
  about_body: string;
  about_mission_title: string;
  about_mission_body: string;
  about_team_intro: string;
  about_team: TeamMember[];
};

const sanitizeSocials = (value: unknown): SocialLink[] => {
  const links: SocialLink[] = [];

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      const url = typeof obj.url === "string" ? obj.url.trim() : "";
      if (!url) continue;
      links.push({ label, url });
    }
    return links;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [rawLabel, rawUrl] of Object.entries(obj)) {
      if (typeof rawUrl !== "string") continue;
      const url = rawUrl.trim();
      if (!url) continue;
      const label = typeof rawLabel === "string" ? rawLabel.trim() || rawLabel : String(rawLabel);
      links.push({ label, url });
    }
    return links;
  }

  return links;
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
  socials: [],
};

export default function AdminSettingsAbout(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<AboutSettings>(safe);

  const applyTeamUpdate = (recipe: (team: TeamMember[]) => TeamMember[]) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextTeam = recipe(prev.about_team);
      setField("about_team", nextTeam);
      return { ...prev, about_team: nextTeam };
    });
  };

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof AboutSettings>(key: K, value: AboutSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const updateMember = <K extends keyof TeamMember>(index: number, key: K, value: TeamMember[K]) => {
    applyTeamUpdate((team) =>
      team.map((member, idx) => {
        if (idx !== index) return member;
        const nextMember: TeamMember = { ...member, [key]: value };
        if (key === "photo_url" && typeof value === "string") {
          nextMember.photo_url = normalizeAdminUrl(value);
        }
        return nextMember;
      })
    );
  };

  const updateSocialLink = (
    memberIndex: number,
    socialIndex: number,
    field: keyof SocialLink,
    value: string
  ) => {
    applyTeamUpdate((team) =>
      team.map((member, idx) => {
        if (idx !== memberIndex) return member;
        const socials = member.socials.map((social, sIdx) => {
          if (sIdx !== socialIndex) return social;
          if (field === "url") {
            const trimmed = value.trim();
            return { ...social, url: trimmed ? normalizeAdminUrl(trimmed) : "" };
          }
          if (field === "label") {
            return { ...social, label: value };
          }
          return social;
        });
        return { ...member, socials };
      })
    );
  };

  const addSocialLink = (index: number) => {
    applyTeamUpdate((team) =>
      team.map((member, idx) => {
        if (idx !== index) return member;
        return { ...member, socials: [...member.socials, { label: "", url: "" }] };
      })
    );
  };

  const removeSocialLink = (memberIndex: number, socialIndex: number) => {
    applyTeamUpdate((team) =>
      team.map((member, idx) => {
        if (idx !== memberIndex) return member;
        return {
          ...member,
          socials: member.socials.filter((_, sIdx) => sIdx !== socialIndex),
        };
      })
    );
  };

  const addMember = () => {
    applyTeamUpdate((team) => [...team, { ...blankMember }]);
  };

  const removeMember = (index: number) => {
    applyTeamUpdate((team) => team.filter((_, idx) => idx !== index));
  };

  const moveMember = (index: number, direction: "up" | "down") => {
    if (disabled) return;
    let nextTeam: TeamMember[] | null = null;
    setLocal((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.about_team.length) {
        nextTeam = null;
        return prev;
      }
      nextTeam = [...prev.about_team];
      const [moved] = nextTeam.splice(index, 1);
      nextTeam.splice(targetIndex, 0, moved);
      return { ...prev, about_team: nextTeam };
    });
    if (nextTeam) {
      setField("about_team", nextTeam);
    }
  };

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
          <div className="space-y-8">
            {local.about_team.map((member, index) => {
              const canMoveUp = index > 0;
              const canMoveDown = index < local.about_team.length - 1;

              return (
                <div key={index} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Member {index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveMember(index, "up")}
                        disabled={disabled || !canMoveUp}
                        className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMember(index, "down")}
                        disabled={disabled || !canMoveDown}
                        className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Move down
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                    <div className="lg:pt-1">
                      <SettingsUploader
                        label="Portrait"
                        value={member.photo_url}
                        onChange={(url) => updateMember(index, "photo_url", url)}
                        accept="image/*"
                        buttonLabel="Upload portrait"
                        disabled={disabled}
                        pickerKind="image"
                        appearance="light"
                        layout="stacked"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
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

                      <label className="block text-sm font-semibold">
                        Bio
                        <textarea
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-3 text-black min-h-[120px]"
                          value={member.bio}
                          onChange={(event) => updateMember(index, "bio", event.target.value)}
                          disabled={disabled}
                        />
                      </label>

                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Social links
                          </span>
                          <button
                            type="button"
                            onClick={() => addSocialLink(index)}
                            disabled={disabled}
                            className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Add social link
                          </button>
                        </div>

                        {member.socials.length === 0 ? (
                          <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                            No social links yet. Add one to highlight where fans can follow this collaborator.
                          </p>
                        ) : (
                          <div className="space-y-4">
                            {member.socials.map((social, socialIndex) => (
                              <div key={socialIndex} className="rounded border border-gray-200 bg-gray-50 p-4 space-y-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Label
                                    <input
                                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black text-sm"
                                      value={social.label}
                                      onChange={(event) => updateSocialLink(index, socialIndex, "label", event.target.value)}
                                      disabled={disabled}
                                      placeholder="Instagram"
                                    />
                                  </label>
                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Link
                                    <input
                                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black text-sm"
                                      value={social.url}
                                      onChange={(event) => updateSocialLink(index, socialIndex, "url", event.target.value)}
                                      disabled={disabled}
                                      placeholder="https://example.com/your-handle"
                                    />
                                  </label>
                                </div>
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => removeSocialLink(index, socialIndex)}
                                    disabled={disabled}
                                    className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Remove link
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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
              );
            })}
          </div>
        )}
      </section>

      <AdminPageThemeOverride prefix="about" pageName="About" />
    </div>
  );
}

