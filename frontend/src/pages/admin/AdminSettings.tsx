/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettings.tsx
   -------------------------------------------------------------------------
   Admin hub: stage switch, Save Draft / Pull Live / Preview Draft / Publish.
   ========================================================================= */
import React, { useMemo, useState } from "react";
import AdminSettingsHome from "./AdminSettingsHome";
import AdminSettingsGeneral from "./AdminSettingsGeneral";
import { useSettings } from "../../lib/SettingsContext";

const TABS = ["home", "general", "about", "events", "media", "merch", "contact"] as const;
type Tab = (typeof TABS)[number];

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const { stage, setStage, isDirty, saving, save, pullLive, publish } = useSettings();

  const previewUrl = useMemo(() => `${window.location.origin}/?stage=draft`, []);

  const renderTab = () => {
    switch (activeTab) {
      case "home": return <AdminSettingsHome />;
      case "general": return <AdminSettingsGeneral />;
      default: return <div className="text-sm opacity-70">(Coming soon)</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-black">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-2xl font-bold">Admin Settings</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm opacity-80">View:</label>
            <select
              className="border rounded px-2 py-1 bg-white"
              value={stage}
              onChange={(e) => setStage(e.target.value as "live" | "draft")}
            >
              <option value="live">Live</option>
              <option value="draft">Draft</option>
            </select>

            <button
              onClick={save}
              disabled={stage !== "draft" || !isDirty || saving}
              className={`px-3 py-1 rounded font-semibold ${
                stage !== "draft" || !isDirty || saving
                  ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
              title="Save changes to Draft"
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>

            <button
              onClick={async () => { await pullLive(); }}
              className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
              title="Copy current Live settings into Draft (does not publish)"
            >
              Pull Current Live
            </button>

            <button
              onClick={() => window.open(previewUrl, "_blank")}
              className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
              title="Open the public site with the draft values"
            >
              Preview Draft
            </button>

            <button
              onClick={publish}
              className="px-3 py-1 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
              title="Copy the current Draft into Live"
            >
              Publish to Live
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded capitalize ${
                activeTab === tab ? "bg-yellow-400 text-black font-semibold" : "bg-gray-200 hover:bg-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8">{renderTab()}</div>
      </div>
    </div>
  );
}
