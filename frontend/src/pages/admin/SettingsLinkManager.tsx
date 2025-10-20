import React from "react";

const emptyLink = () => ({ label: "", url: "" });

function normalizeLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      url: typeof item.url === "string" ? item.url : "",
    }));
}

function SettingsLinkManager({ label, value, onChange, addLabel = "Add Link", disabled = false }) {
  const links = normalizeLinks(value);

  const updateLink = (index, next) => {
    if (disabled) return;
    const updated = links.map((item, idx) => (idx === index ? { ...item, ...next } : item));
    onChange(updated);
  };

  const removeLink = (index) => {
    if (disabled) return;
    const updated = links.filter((_, idx) => idx !== index);
    onChange(updated);
  };

  const addLink = () => {
    if (disabled) return;
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
        disabled={disabled}
        className={`px-4 py-2 font-semibold rounded ${
          disabled
            ? "bg-blue-300 text-white/80 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {addLabel}
      </button>
    </div>
  );
}

export default SettingsLinkManager;
