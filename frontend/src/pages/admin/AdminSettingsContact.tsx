/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettingsContact.tsx
   -------------------------------------------------------------------------
   Admin editor for contact page copy, cards, and social links.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";

type ContactCard = {
  title: string;
  description: string;
  link_label: string;
  link_url: string;
};

type SocialLinks = {
  instagram?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
  facebook?: string;
};

type ContactSettings = {
  contact_title: string;
  contact_intro: string;
  contactemail: string;
  contactphone: string;
  contact_socials: SocialLinks;
  contact_cards: ContactCard[];
};

const sanitizeCards = (value: unknown): ContactCard[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title : "",
        description: typeof obj.description === "string" ? obj.description : "",
        link_label: typeof obj.link_label === "string" ? obj.link_label : "",
        link_url: typeof obj.link_url === "string" ? obj.link_url : "",
      };
    });
};

const sanitizeSocials = (value: unknown): SocialLinks => {
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const socials: SocialLinks = {};
  for (const key of ["instagram", "twitter", "youtube", "tiktok", "facebook"] as const) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) socials[key] = raw.trim();
  }
  return socials;
};

const sanitize = (raw: unknown): ContactSettings => {
  const safe = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    contact_title: typeof safe.contact_title === "string" ? safe.contact_title : "Contact Us",
    contact_intro:
      typeof safe.contact_intro === "string"
        ? safe.contact_intro
        : "Booking, collaborations, or just want to say hi? Reach out below.",
    contactemail: typeof safe.contactemail === "string" ? safe.contactemail : "",
    contactphone: typeof safe.contactphone === "string" ? safe.contactphone : "",
    contact_socials: sanitizeSocials(safe.contact_socials),
    contact_cards: sanitizeCards(safe.contact_cards),
  };
};

const blankCard: ContactCard = {
  title: "New inquiry",
  description: "Describe how folks should reach out.",
  link_label: "Contact",
  link_url: "mailto:info@toofunnyproductions.com",
};

export default function AdminSettingsContact(): JSX.Element {
  const { settings, setField, stage, lockedByOther } = useSettings();

  const safe = useMemo(() => sanitize(settings), [settings]);
  const disabled = stage !== "draft" || lockedByOther;

  const [local, setLocal] = useState<ContactSettings>(safe);

  useEffect(() => {
    setLocal(safe);
  }, [safe]);

  const updateField = <K extends keyof ContactSettings>(key: K, value: ContactSettings[K]) => {
    if (disabled) return;
    setLocal((prev) => ({ ...prev, [key]: value }));
    setField(key as string, value);
  };

  const updateCard = (index: number, patch: Partial<ContactCard>) => {
    if (disabled) return;
    setLocal((prev) => {
      const nextCards = prev.contact_cards.map((card, idx) =>
        idx === index ? { ...card, ...patch } : card
      );
      setField("contact_cards", nextCards);
      return { ...prev, contact_cards: nextCards };
    });
  };

  const addCard = () => {
    if (disabled) return;
    const next = [...local.contact_cards, { ...blankCard }];
    setLocal((prev) => ({ ...prev, contact_cards: next }));
    setField("contact_cards", next);
  };

  const removeCard = (index: number) => {
    if (disabled) return;
    const next = local.contact_cards.filter((_, idx) => idx !== index);
    setLocal((prev) => ({ ...prev, contact_cards: next }));
    setField("contact_cards", next);
  };

  const updateSocial = (key: keyof SocialLinks, value: string) => {
    if (disabled) return;
    setLocal((prev) => {
      const socials = { ...prev.contact_socials };
      if (value.trim()) {
        socials[key] = value.trim();
      } else {
        delete socials[key];
      }
      setField("contact_socials", socials);
      return { ...prev, contact_socials: socials };
    });
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
          <label className="block text-sm font-semibold mb-1">Contact Page Title</label>
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-black"
            value={local.contact_title}
            onChange={(event) => updateField("contact_title", event.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Intro Paragraph</label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-black min-h-[100px]"
            value={local.contact_intro}
            onChange={(event) => updateField("contact_intro", event.target.value)}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold">
          Contact email
          <input
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
            value={local.contactemail}
            onChange={(event) => updateField("contactemail", event.target.value)}
            disabled={disabled}
            placeholder="team@toofunnyproductions.com"
          />
        </label>
        <label className="text-sm font-semibold">
          Contact phone
          <input
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
            value={local.contactphone}
            onChange={(event) => updateField("contactphone", event.target.value)}
            disabled={disabled}
            placeholder="555-123-4567"
          />
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Contact cards</h3>
        <p className="text-sm text-gray-600">Use these to highlight booking, press, or collaboration requests.</p>
        <button
          type="button"
          onClick={addCard}
          disabled={disabled}
          className={`rounded px-3 py-2 text-sm font-semibold ${
            disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          Add contact card
        </button>

        {local.contact_cards.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            No contact cards yet. Add one to provide quick shortcuts for common requests.
          </p>
        ) : (
          <div className="space-y-4">
            {local.contact_cards.map((card, index) => (
              <div key={index} className="rounded border border-gray-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Title
                    <input
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                      value={card.title}
                      onChange={(event) => updateCard(index, { title: event.target.value })}
                      disabled={disabled}
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Button label
                    <input
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                      value={card.link_label}
                      onChange={(event) => updateCard(index, { link_label: event.target.value })}
                      disabled={disabled}
                    />
                  </label>
                </div>

                <label className="text-sm font-semibold block">
                  Description
                  <textarea
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black min-h-[80px]"
                    value={card.description}
                    onChange={(event) => updateCard(index, { description: event.target.value })}
                    disabled={disabled}
                  />
                </label>

                <label className="text-sm font-semibold block">
                  Button link
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                    value={card.link_url}
                    onChange={(event) => updateCard(index, { link_url: event.target.value })}
                    disabled={disabled}
                    placeholder="mailto:booking@toofunnyproductions.com"
                  />
                </label>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeCard(index)}
                    disabled={disabled}
                    className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove card
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Social links</h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(["instagram", "twitter", "youtube", "tiktok", "facebook"] as const).map((network) => (
            <label key={network} className="text-sm font-semibold">
              {network.charAt(0).toUpperCase() + network.slice(1)}
              <input
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-black"
                value={local.contact_socials[network] || ""}
                onChange={(event) => updateSocial(network, event.target.value)}
                disabled={disabled}
                placeholder={`https://…/${network}`}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

