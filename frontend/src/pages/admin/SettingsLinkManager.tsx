import React from "react";

import { normalizeAdminUrl } from "../../utils/url";

export type LinkValue = {
  label: string;
  url: string;
};

type SettingsLinkManagerProps = {
  label?: string;
  value: LinkValue[];
  onChange: (links: LinkValue[]) => void;
  addLabel?: string;
  disabled?: boolean;
  maxItems?: number;
};

const emptyLink = (): LinkValue => ({ label: "", url: "" });

const normalizeLinks = (value: LinkValue[] | unknown): LinkValue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is LinkValue =>
      !!item &&
      typeof item === "object" &&
      typeof (item as LinkValue).label === "string" &&
      typeof (item as LinkValue).url === "string"
    )
    .map((item) => ({ label: item.label, url: item.url }));
};

export default function SettingsLinkManager({
  label,
  value,
  onChange,
  addLabel = "Add Link",
  disabled = false,
  maxItems,
}: SettingsLinkManagerProps): JSX.Element {
  const links = normalizeLinks(value);
  const maxReached = typeof maxItems === "number" && links.length >= maxItems;

  const updateLink = (index: number, next: Partial<LinkValue>) => {
    if (disabled) return;
    const patch: Partial<LinkValue> = { ...next };
    if (typeof next.url === "string") {
      patch.url = normalizeAdminUrl(next.url);
    }
    const updated = links.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    onChange(updated);
  };

  const removeLink = (index: number) => {
    if (disabled) return;
    const updated = links.filter((_, idx) => idx !== index);
    onChange(updated);
  };

  const addLink = () => {
    if (disabled || maxReached) return;
    onChange([...links, emptyLink()]);
  };

  return (
    <div className="space-y-4">
      {label ? <div className="font-semibold">{label}</div> : null}
      {links.length === 0 ? (
        <p className="text-sm text-gray-500">No links yet. Use the button below to add one.</p>
      ) : (
        <div className="space-y-4">
          {links.map((link, index) => (
            <div key={index} className="grid md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
              <label className="block">
                <div className="text-xs font-semibold uppercase tracking-wide mb-1">Label</div>
                <input
                  className="w-full border border-gray-300 rounded px-3 py-2 text-black"
                  placeholder="Navigation Label"
                  value={link.label}
                  onChange={(e) => updateLink(index, { label: e.target.value })}
                  disabled={disabled}
                />
              </label>

              <label className="block">
                <div className="text-xs font-semibold uppercase tracking-wide mb-1">URL</div>
                <input
                  className="w-full border border-gray-300 rounded px-3 py-2 text-black"
                  placeholder="https://example.com"
                  value={link.url}
                  onChange={(e) => updateLink(index, { url: e.target.value })}
                  disabled={disabled}
                />
              </label>

              <button
                type="button"
                onClick={() => removeLink(index)}
                disabled={disabled}
                className={`self-center px-3 py-2 text-sm font-semibold rounded ${
                  disabled
                    ? "bg-red-300 text-white/80 cursor-not-allowed"
                    : "bg-red-500 text-white hover:bg-red-600"
                }`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addLink}
        disabled={disabled || maxReached}
        className={`px-4 py-2 font-semibold rounded ${
          disabled || maxReached
            ? "bg-blue-300 text-white/80 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {maxReached ? "Link limit reached" : addLabel}
      </button>
    </div>
  );
}
