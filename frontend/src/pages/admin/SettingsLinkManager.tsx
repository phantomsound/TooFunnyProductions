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
    <div className="space-y-4 text-sm text-neutral-100">
      {label ? <div className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{label}</div> : null}
      {links.length === 0 ? (
        <p className="text-sm text-neutral-400">No links yet. Use the button below to add one.</p>
      ) : (
        <div className="space-y-4">
          {links.map((link, index) => (
            <div key={index} className="grid items-start gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="block text-xs uppercase tracking-wide">
                <div className="mb-1 font-semibold text-neutral-300">Label</div>
                <input
                  className="w-full rounded border border-neutral-700 bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
                  placeholder="Navigation Label"
                  value={link.label}
                  onChange={(e) => updateLink(index, { label: e.target.value })}
                  disabled={disabled}
                />
              </label>

              <label className="block text-xs uppercase tracking-wide">
                <div className="mb-1 font-semibold text-neutral-300">URL</div>
                <input
                  className="w-full rounded border border-neutral-700 bg-neutral-900/80 px-3 py-2 !text-white placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
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
                className={`self-center rounded px-3 py-2 text-sm font-semibold transition ${
                  disabled
                    ? "cursor-not-allowed bg-neutral-700 text-neutral-500"
                    : "bg-red-500 text-white hover:bg-red-400"
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
        className={`rounded px-4 py-2 font-semibold transition ${
          disabled || maxReached
            ? "cursor-not-allowed bg-neutral-700 text-neutral-500"
            : "bg-yellow-400 text-black hover:bg-yellow-300"
        }`}
      >
        {maxReached ? "Link limit reached" : addLabel}
      </button>
    </div>
  );
}
