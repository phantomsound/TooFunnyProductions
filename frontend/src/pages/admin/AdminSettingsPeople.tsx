/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsPeople.tsx
   -------------------------------------------------------------------------
   Admin editor for people profiles used across About + carousels.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import SettingsUploader from "./SettingsUploader";
import { normalizeAdminUrl } from "../../utils/url";
import { PeopleProfile, PeopleSocialLink, sanitizePeopleProfiles } from "../../utils/people";

const MAX_SOCIAL_LINKS = 10;

type PeopleSettings = {
  people_profiles: PeopleProfile[];
};

const createId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `person-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const sanitize = (raw: unknown): PeopleSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    people_profiles: sanitizePeopleProfiles(safe.people_profiles),
  };
};

const blankSocial: PeopleSocialLink = {
  label: "",
  url: "",
  show_in_carousel: true,
};

const createBlankPerson = (): PeopleProfile => ({
  id: createId(),
  name: "",
  title: "",
  bio: "",
  photo_url: "",
  socials: [],
  show_on_home: false,
  show_on_media: false,
  carousel_text_mode: "about",
  carousel_text: "",
});

export default function AdminSettingsPeople(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<PeopleSettings>(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const applyPeopleUpdate = (recipe: (people: PeopleProfile[]) => PeopleProfile[]) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextPeople = recipe(prev.people_profiles);
      setField("people_profiles", nextPeople);
      return { ...prev, people_profiles: nextPeople };
    });
  };

  const updatePerson = <K extends keyof PeopleProfile>(index: number, key: K, value: PeopleProfile[K]) => {
    applyPeopleUpdate((people) =>
      people.map((person, idx) => {
        if (idx !== index) return person;
        const next = { ...person, [key]: value } as PeopleProfile;
        if (key === "photo_url" && typeof value === "string") {
          next.photo_url = normalizeAdminUrl(value);
        }
        return next;
      })
    );
  };

  const updateSocialLink = (
    personIndex: number,
    socialIndex: number,
    field: keyof PeopleSocialLink,
    value: string | boolean
  ) => {
    applyPeopleUpdate((people) =>
      people.map((person, idx) => {
        if (idx !== personIndex) return person;
        const socials = person.socials.map((social, sIdx) => {
          if (sIdx !== socialIndex) return social;
          if (field === "url" && typeof value === "string") {
            const trimmed = value.trim();
            return { ...social, url: trimmed ? normalizeAdminUrl(trimmed) : "" };
          }
          if (field === "label" && typeof value === "string") {
            return { ...social, label: value };
          }
          if (field === "show_in_carousel" && typeof value === "boolean") {
            return { ...social, show_in_carousel: value };
          }
          return social;
        });
        return { ...person, socials };
      })
    );
  };

  const addSocialLink = (index: number) => {
    applyPeopleUpdate((people) =>
      people.map((person, idx) => {
        if (idx !== index) return person;
        if (person.socials.length >= MAX_SOCIAL_LINKS) return person;
        return { ...person, socials: [...person.socials, { ...blankSocial }] };
      })
    );
  };

  const removeSocialLink = (personIndex: number, socialIndex: number) => {
    applyPeopleUpdate((people) =>
      people.map((person, idx) => {
        if (idx !== personIndex) return person;
        return { ...person, socials: person.socials.filter((_, sIdx) => sIdx !== socialIndex) };
      })
    );
  };

  const moveSocialLink = (personIndex: number, socialIndex: number, direction: "up" | "down") => {
    if (disabled) return;
    applyPeopleUpdate((people) =>
      people.map((person, idx) => {
        if (idx !== personIndex) return person;
        const targetIndex = direction === "up" ? socialIndex - 1 : socialIndex + 1;
        if (targetIndex < 0 || targetIndex >= person.socials.length) return person;
        const socials = [...person.socials];
        const [moved] = socials.splice(socialIndex, 1);
        socials.splice(targetIndex, 0, moved);
        return { ...person, socials };
      })
    );
  };

  const addPerson = () => {
    applyPeopleUpdate((people) => [...people, createBlankPerson()]);
  };

  const removePerson = (index: number) => {
    applyPeopleUpdate((people) => people.filter((_, idx) => idx !== index));
  };

  const movePerson = (index: number, direction: "up" | "down") => {
    if (disabled) return;
    let nextPeople: PeopleProfile[] | null = null;
    setLocal((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.people_profiles.length) {
        nextPeople = null;
        return prev;
      }
      nextPeople = [...prev.people_profiles];
      const [moved] = nextPeople.splice(index, 1);
      nextPeople.splice(targetIndex, 0, moved);
      return { ...prev, people_profiles: nextPeople };
    });
    if (nextPeople) {
      setField("people_profiles", nextPeople);
    }
  };

  const importLegacyTeam = () => {
    if (disabled) return;
    const legacy = Array.isArray(settings?.about_team) ? settings.about_team : [];
    if (legacy.length === 0) return;
    const migrated = legacy
      .filter((entry: any) => entry && typeof entry === "object")
      .map((entry: any) => ({
        id: createId(),
        name: typeof entry.name === "string" ? entry.name : "",
        title: typeof entry.title === "string" ? entry.title : "",
        bio: typeof entry.bio === "string" ? entry.bio : "",
        photo_url: typeof entry.photo_url === "string" ? entry.photo_url : "",
        socials: Array.isArray(entry.socials)
          ? entry.socials.map((social: any) => ({
              label: typeof social?.label === "string" ? social.label : "",
              url: typeof social?.url === "string" ? social.url : "",
              show_in_carousel: true,
            }))
          : [],
        show_on_home: false,
        show_on_media: false,
        carousel_text_mode: "about",
        carousel_text: "",
      }));

    applyPeopleUpdate(() => migrated);
  };

  const hasLegacyTeam = Array.isArray(settings?.about_team) && settings?.about_team.length > 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      {lockedByOther ? (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          Draft is locked by another editor. Fields are read-only until they release the lock.
        </div>
      ) : stage !== "draft" ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Switch to the Draft view to edit these fields.
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <p className="font-semibold text-neutral-900">People Profiles</p>
        <p className="mt-2">
          Manage the talent roster for the About page and the new Home + Media carousels. Toggle where each person should
          appear and choose whether the carousel pulls from their About bio or a custom snippet.
        </p>
        {hasLegacyTeam && local.people_profiles.length === 0 ? (
          <button
            type="button"
            onClick={importLegacyTeam}
            disabled={disabled}
            className="mt-3 rounded border border-blue-500 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Import existing About team
          </button>
        ) : null}
      </div>

      {local.people_profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
          No people profiles yet. Add your first profile to populate the About page and carousels.
        </div>
      ) : null}

      <div className="space-y-6">
        {local.people_profiles.map((person, index) => {
          const canMoveUp = index > 0;
          const canMoveDown = index < local.people_profiles.length - 1;
          const useCustomText = person.carousel_text_mode === "custom";

          return (
            <div key={person.id || `${person.name}-${index}`} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-neutral-900">Person {index + 1}</h3>
                  <p className="text-xs text-neutral-500">Shown on About, Home carousel, and/or Media carousel.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => movePerson(index, "up")}
                    disabled={!canMoveUp || disabled}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => movePerson(index, "down")}
                    disabled={!canMoveDown || disabled}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => removePerson(index)}
                    disabled={disabled}
                    className="rounded border border-red-400 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Name</label>
                    <input
                      type="text"
                      value={person.name}
                      onChange={(event) => updatePerson(index, "name", event.target.value)}
                      disabled={disabled}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Title</label>
                    <input
                      type="text"
                      value={person.title}
                      onChange={(event) => updatePerson(index, "title", event.target.value)}
                      disabled={disabled}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">About Bio</label>
                    <textarea
                      value={person.bio}
                      onChange={(event) => updatePerson(index, "bio", event.target.value)}
                      disabled={disabled}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      rows={4}
                    />
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={person.show_on_home}
                        onChange={(event) => updatePerson(index, "show_on_home", event.target.checked)}
                        disabled={disabled}
                      />
                      Show on Home carousel
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={person.show_on_media}
                        onChange={(event) => updatePerson(index, "show_on_media", event.target.checked)}
                        disabled={disabled}
                      />
                      Show on Media carousel
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <SettingsUploader
                    label="Headshot"
                    value={person.photo_url}
                    onChange={(value) => updatePerson(index, "photo_url", value)}
                    accept="image/*"
                    pickerKind="image"
                    buttonLabel="Upload photo"
                    disabled={disabled}
                    allowLibrary
                    appearance="light"
                    layout="stacked"
                  />

                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Carousel text</label>
                    <select
                      value={person.carousel_text_mode}
                      onChange={(event) =>
                        updatePerson(index, "carousel_text_mode", event.target.value === "custom" ? "custom" : "about")
                      }
                      disabled={disabled}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    >
                      <option value="about">Use About bio</option>
                      <option value="custom">Use custom text</option>
                    </select>
                    {useCustomText ? (
                      <textarea
                        value={person.carousel_text}
                        onChange={(event) => updatePerson(index, "carousel_text", event.target.value)}
                        disabled={disabled}
                        className="mt-2 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                        rows={3}
                        placeholder="Custom carousel description"
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-5 border-t border-neutral-200 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-900">Social Links</h4>
                    <p className="text-xs text-neutral-500">Toggle which social links appear in the carousel cards.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addSocialLink(index)}
                    disabled={disabled || person.socials.length >= MAX_SOCIAL_LINKS}
                    className="rounded border border-blue-500 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Add social link
                  </button>
                </div>

                {person.socials.length === 0 ? (
                  <p className="mt-3 text-xs text-neutral-500">No social links yet.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {person.socials.map((social, socialIndex) => {
                      const canMoveSocialUp = socialIndex > 0;
                      const canMoveSocialDown = socialIndex < person.socials.length - 1;
                      return (
                        <div key={`${person.id}-${socialIndex}`} className="rounded border border-neutral-200 bg-neutral-50 p-3">
                          <div className="grid gap-3 md:grid-cols-[1.2fr_1.4fr_auto] md:items-center">
                            <input
                              type="text"
                              placeholder="Label"
                              value={social.label}
                              onChange={(event) => updateSocialLink(index, socialIndex, "label", event.target.value)}
                              disabled={disabled}
                              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                            />
                            <input
                              type="url"
                              placeholder="https://"
                              value={social.url}
                              onChange={(event) => updateSocialLink(index, socialIndex, "url", event.target.value)}
                              disabled={disabled}
                              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                            />
                            <label className="inline-flex items-center gap-2 text-xs text-neutral-600">
                              <input
                                type="checkbox"
                                checked={social.show_in_carousel}
                                onChange={(event) =>
                                  updateSocialLink(index, socialIndex, "show_in_carousel", event.target.checked)
                                }
                                disabled={disabled}
                              />
                              Show in carousel
                            </label>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => moveSocialLink(index, socialIndex, "up")}
                              disabled={disabled || !canMoveSocialUp}
                              className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Move up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSocialLink(index, socialIndex, "down")}
                              disabled={disabled || !canMoveSocialDown}
                              className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Move down
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSocialLink(index, socialIndex)}
                              disabled={disabled}
                              className="rounded border border-red-400 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addPerson}
        disabled={disabled}
        className="rounded border border-green-500 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Add person
      </button>

    </div>
  );
}
