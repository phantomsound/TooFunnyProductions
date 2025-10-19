import React from "react";

interface SettingsColorPickerProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  onSave?: () => void;
}

const SettingsColorPicker: React.FC<SettingsColorPickerProps> = ({
  label,
  value,
  onChange,
  onSave,
}) => {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div>
        <label className="block text-sm font-semibold mb-1">{label}</label>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-10 rounded cursor-pointer border"
        />
      </div>
      <div className="flex flex-col">
        <span className="text-sm">{value}</span>
        {onSave && (
          <button
            onClick={onSave}
            className="text-xs px-2 py-1 mt-1 rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
};

export default SettingsColorPicker;
