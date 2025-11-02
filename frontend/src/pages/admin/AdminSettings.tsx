/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettings.tsx
   -------------------------------------------------------------------------
   Admin hub: stage switch, Save Draft / Pull Live / Preview Draft / Publish.
   ========================================================================= */
import React, { useCallback, useMemo, useState } from "react";
import AdminSettingsHome from "./AdminSettingsHome";
import AdminSettingsAbout from "./AdminSettingsAbout";
import AdminSettingsEvents from "./AdminSettingsEvents";
import AdminSettingsMedia from "./AdminSettingsMedia";
import AdminSettingsMerch from "./AdminSettingsMerch";
import AdminSettingsContact from "./AdminSettingsContact";
import AdminSettingsSnapshots from "./AdminSettingsSnapshots";
import AdminPublishConfirm from "./AdminPublishConfirm";
import AdminLockAcquireModal from "./AdminLockAcquireModal";
import { useSettings, type AcquireSelection } from "../../lib/SettingsContext";

const TABS = ["home", "about", "events", "media", "merch", "contact"] as const;
type Tab = (typeof TABS)[number];

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showAcquireModal, setShowAcquireModal] = useState(false);
  const {
    stage,
    setStage,
    isDirty,
    saving,
    save,
    pullLive,
    publishing,
    settings,
    lock,
    hasLock,
    lockedByOther,
    lockLoading,
    lockError,
    acquireLock,
    releaseLock,
    reload,
  } = useSettings();

  const previewUrl = useMemo(() => `${window.location.origin}/?stage=draft`, []);

  const handleAcquireSelection = useCallback(
    async (selection: AcquireSelection) => {
      const success = await acquireLock({ silent: false, selection });
      if (!success) {
        throw new Error(lockError || "Failed to acquire lock");
      }
    },
    [acquireLock, lockError]
  );

  const lockOwner = lock?.holder_email || null;
  const lockStatus = hasLock
    ? "You hold the draft lock"
    : lockedByOther
    ? `Locked by ${lockOwner}`
    : "No active lock";

  const handleSnapshotRestored = useCallback(async () => {
    await reload();
    await acquireLock({ silent: true });
  }, [reload, acquireLock]);

  const renderTab = () => {
    switch (activeTab) {
      case "home":
        return <AdminSettingsHome />;
      case "about":
        return <AdminSettingsAbout />;
      case "events":
        return <AdminSettingsEvents />;
      case "media":
        return <AdminSettingsMedia />;
      case "merch":
        return <AdminSettingsMerch />;
      case "contact":
        return <AdminSettingsContact />;
      default:
        return <div className="text-sm opacity-70">(Coming soon)</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-black">
      <div className="space-y-8 pb-10">
        {/* Header actions */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="text-2xl font-bold">Page Configurations</h2>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <div className="flex flex-col gap-1 text-right">
              <label className="text-xs uppercase tracking-wide text-gray-500">Draft lock</label>
              <div className="flex items-center justify-end gap-2">
                <span
                  className={`text-sm ${
                    hasLock ? "text-green-500" : lockedByOther ? "text-red-500" : "text-gray-600"
                  }`}
                >
                  {lockStatus}
                </span>
                {hasLock ? (
                  <button
                    onClick={() => releaseLock({ silent: false })}
                    disabled={lockLoading}
                    className="rounded border border-red-400 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Release
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAcquireModal(true)}
                    disabled={lockLoading || stage !== "draft"}
                    className="rounded border border-blue-500 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Acquire
                  </button>
                )}
              </div>
              {lockError ? <span className="text-xs text-red-500">{lockError}</span> : null}
            </div>

            <div className="flex items-center gap-2 lg:ml-auto">
              <label className="text-sm opacity-80">View:</label>
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={stage}
                onChange={(e) => setStage(e.target.value as "live" | "draft")}
              >
                <option value="live">Live</option>
                <option value="draft">Draft</option>
              </select>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
              <button
                onClick={() => save()}
                disabled={stage !== "draft" || !isDirty || saving || lockedByOther}
                className={`px-3 py-1 rounded font-semibold focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                  stage !== "draft" || !isDirty || saving || lockedByOther
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-300"
                }`}
                title="Save changes to Draft"
              >
                {saving ? "Saving…" : "Save Draft"}
              </button>

              <button
                onClick={async () => { await pullLive(); }}
                className="px-3 py-1 rounded border border-blue-500 bg-blue-50 font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={lockLoading || lockedByOther}
                title="Copy current Live settings into Draft (does not publish)"
              >
                Pull Current Live
              </button>

              <button
                onClick={() => window.open(previewUrl, "_blank")}
                className="px-3 py-1 rounded border border-neutral-400 bg-neutral-100 font-semibold text-neutral-800 hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-neutral-400"
                title="Open the public site with the draft values"
              >
                Preview Draft
              </button>

              <button
                onClick={() => setShowSnapshots(true)}
                className="px-3 py-1 rounded border border-purple-500 bg-purple-50 font-semibold text-purple-700 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-purple-300"
                title="Manage saved draft snapshots"
              >
                Snapshots
              </button>

              <button
                onClick={() => setShowPublishConfirm(true)}
                className="px-3 py-1 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={lockLoading || lockedByOther || saving || publishing}
                title="Copy the current Draft into Live"
              >
                {publishing ? "Publishing…" : "Publish to Live"}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="rounded-lg border border-neutral-300 bg-white/70 p-4 text-sm text-neutral-700">
          <p className="font-semibold text-neutral-900">Configure each page’s content here.</p>
          <p className="mt-2">
            Looking for logos, theme colors, or maintenance mode? Head to <span className="font-semibold">General Settings</span>
            from the sidebar to manage site-wide options, then fine-tune each page below.
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`min-w-fit rounded px-4 py-2 capitalize ${
                activeTab === tab ? "bg-yellow-400 text-black font-semibold" : "bg-gray-200 hover:bg-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="rounded-lg bg-white p-6 shadow-md">{renderTab()}</div>
      </div>

      <AdminLockAcquireModal
        open={showAcquireModal}
        onClose={() => setShowAcquireModal(false)}
        onSelect={handleAcquireSelection}
      />
      <AdminSettingsSnapshots
        open={showSnapshots}
        onClose={() => setShowSnapshots(false)}
        onRestored={handleSnapshotRestored}
      />
      <AdminPublishConfirm
        open={showPublishConfirm}
        draftUpdatedAt={typeof settings?.updated_at === "string" ? settings?.updated_at : null}
        onClose={() => setShowPublishConfirm(false)}
      />
    </div>
  );
}
