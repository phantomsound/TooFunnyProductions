/* =========================================================================
   FILE: frontend/src/pages/admin/AdminSettings.tsx
   -------------------------------------------------------------------------
   Admin hub: stage switch, Save Draft / Pull Live / Preview Draft / Publish.
   ========================================================================= */
import React, { useCallback, useMemo, useState } from "react";
import AdminSettingsHome from "./AdminSettingsHome";
import AdminSettingsAbout from "./AdminSettingsAbout";
import AdminSettingsPeople from "./AdminSettingsPeople";
import AdminSettingsEvents from "./AdminSettingsEvents";
import AdminSettingsMedia from "./AdminSettingsMedia";
import AdminSettingsMerch from "./AdminSettingsMerch";
import AdminSettingsContact from "./AdminSettingsContact";
import AdminSettingsSnapshots from "./AdminSettingsSnapshots";
import AdminPublishConfirm from "./AdminPublishConfirm";
import AdminLockAcquireModal from "./AdminLockAcquireModal";
import { useSettings, type AcquireSelection } from "../../lib/SettingsContext";

const TABS = ["home", "about", "people", "events", "media", "merch", "contact"] as const;
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
      case "people":
        return <AdminSettingsPeople />;
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
    <div className="space-y-6 text-neutral-100">
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-yellow-300">Page Configurations</h2>
            <p className="text-sm text-neutral-300">Configure each page’s content and layout details.</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <div className="flex flex-col gap-1 text-right">
              <label className="text-xs uppercase tracking-[0.18em] text-neutral-500">Draft lock</label>
              <div className="flex items-center justify-end gap-2">
                <span
                  className={`text-sm ${
                    hasLock ? "text-emerald-400" : lockedByOther ? "text-red-400" : "text-neutral-400"
                  }`}
                >
                  {lockStatus}
                </span>
                {hasLock ? (
                  <button
                    onClick={() => releaseLock({ silent: false })}
                    disabled={lockLoading}
                    className="rounded border border-red-500/60 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Release
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAcquireModal(true)}
                    disabled={lockLoading || stage !== "draft"}
                    className="rounded border border-blue-500/60 bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Acquire
                  </button>
                )}
              </div>
              {lockError ? <span className="text-xs text-red-400">{lockError}</span> : null}
            </div>

            <div className="flex items-center gap-2 lg:ml-auto">
              <label className="text-sm text-neutral-300">View:</label>
              <select
                className="rounded border border-neutral-700 !bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-300"
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
                className={`rounded px-3 py-1 font-semibold transition focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900 ${
                  stage !== "draft" || !isDirty || saving || lockedByOther
                    ? "cursor-not-allowed bg-neutral-700 text-neutral-500"
                    : "bg-yellow-400 text-black hover:bg-yellow-300"
                }`}
                title="Save changes to Draft"
              >
                {saving ? "Saving…" : "Save Draft"}
              </button>

              <button
                onClick={async () => { await pullLive(); }}
                className="rounded border border-blue-500/60 bg-blue-500/10 px-3 py-1 font-semibold text-blue-200 transition hover:bg-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={lockLoading || lockedByOther}
                title="Copy current Live settings into Draft (does not publish)"
              >
                Pull Current Live
              </button>

              <button
                onClick={() => window.open(previewUrl, "_blank")}
                className="rounded border border-neutral-700 !bg-neutral-900 px-3 py-1 font-semibold text-neutral-200 transition hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/40 focus:ring-offset-2 focus:ring-offset-neutral-900"
                title="Open the public site with the draft values"
              >
                Preview Draft
              </button>

              <button
                onClick={() => setShowSnapshots(true)}
                className="rounded border border-purple-500/70 bg-purple-500/10 px-3 py-1 font-semibold text-purple-200 transition hover:bg-purple-500/20 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:ring-offset-2 focus:ring-offset-neutral-900"
                title="Manage saved draft snapshots"
              >
                Snapshots
              </button>

              <button
                onClick={() => setShowPublishConfirm(true)}
                className="rounded bg-yellow-400 px-3 py-1 font-semibold text-black transition hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-200 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={lockLoading || lockedByOther || saving || publishing}
                title="Copy the current Draft into Live"
              >
                {publishing ? "Publishing…" : "Publish to Live"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 text-sm text-neutral-300 shadow-sm backdrop-blur">
        <p>
          Looking for logos, theme colors, or maintenance mode? Head to{" "}
          <span className="font-semibold text-yellow-200">General Settings</span>{" "}
          from the sidebar to manage site-wide options, then fine-tune each page below.
        </p>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm">
        <div className="flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`min-w-fit rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                activeTab === tab
                  ? "bg-yellow-400 text-black"
                  : "border border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-yellow-300 hover:text-yellow-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-6 shadow-lg backdrop-blur">
        {renderTab()}
      </section>

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
