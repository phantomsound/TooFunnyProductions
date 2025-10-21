import React from "react";

type SettingsColorPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  disabled?: boolean;
};

export default function SettingsColorPicker({
  label,
  value,
  onChange,
  onSave,
  disabled = false,
}: SettingsColorPickerProps): JSX.Element {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div>
        <label className="block text-sm font-semibold mb-1">{label}</label>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-12 h-10 rounded border ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-sm">{value}</span>
        {onSave && (
          <button
            onClick={onSave}
            disabled={disabled}
            className={`text-xs px-2 py-1 mt-1 rounded ${
              disabled
                ? "bg-blue-300 text-white/70 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }`}
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}
