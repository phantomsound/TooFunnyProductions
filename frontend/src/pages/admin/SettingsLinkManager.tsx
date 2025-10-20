import React from "react";

export type SettingsLink = { label: string; url: string };

interface SettingsLinkManagerProps {
  label?: string;
  value: SettingsLink[];
  onChange: (links: SettingsLink[]) => void;
  addLabel?: string;
}

const emptyLink = (): SettingsLink => ({ label: "", url: "" });

function normalizeLinks(value: SettingsLink[] | undefined | null): SettingsLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      url: typeof item.url === "string" ? item.url : "",
    }));
}

const SettingsLinkManager: React.FC<SettingsLinkManagerProps> = ({
  label,
  value,
  onChange,
  addLabel = "Add Link",
}) => {
  const links = normalizeLinks(value);

  const updateLink = (index: number, next: Partial<SettingsLink>) => {
    const updated = links.map((item, idx) => (idx === index ? { ...item, ...next } : item));
    onChange(updated);
  };

  const removeLink = (index: number) => {
    const updated = links.filter((_, idx) => idx !== index);
    onChange(updated);
  };

  const addLink = () => {
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
                />
              </label>

              <label className="block">
                <div className="text-xs font-semibold uppercase tracking-wide mb-1">URL</div>
                <input
                  className="w-full border border-gray-300 rounded px-3 py-2 text-black"
                  placeholder="https://example.com"
                  value={link.url}
                  onChange={(e) => updateLink(index, { url: e.target.value })}
                />
              </label>

              <button
                type="button"
                onClick={() => removeLink(index)}
                className="self-center px-3 py-2 bg-red-500 text-white text-sm font-semibold rounded hover:bg-red-600"
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
        className="px-4 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700"
      >
        {addLabel}
      </button>
    </div>
  );
}

export default SettingsLinkManager;
