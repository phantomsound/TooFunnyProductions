import React, { useCallback, useMemo, useState } from "react";

import { useSettings } from "../../lib/SettingsContext";
import AdminSettingsSnapshots from "./AdminSettingsSnapshots";
import AdminSettingsGeneral from "./AdminSettingsGeneral";

export default function AdminGeneralSettingsPage(): JSX.Element {
  const {
    stage,
    setStage,
    isDirty,
    saving,
    save,
    pullLive,
    publish,
    lock,
    hasLock,
    lockedByOther,
    lockLoading,
    lockError,
    acquireLock,
    releaseLock,
    reload,
  } = useSettings();

  const [showSnapshots, setShowSnapshots] = useState(false);
  const previewUrl = useMemo(() => `${window.location.origin}/?stage=draft`, []);

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

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-300 bg-white/80 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl space-y-1">
            <h2 className="text-2xl font-bold text-neutral-900">General Settings</h2>
            <p className="text-sm text-neutral-600">
              Tune the global look and feel of Too Funny Productions. Update the brand copy, upload logos, and manage
              color themes that cascade across every page unless a page override is configured.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-col gap-1 text-right">
              <label className="text-xs uppercase tracking-wide text-gray-500">Draft lock</label>
              <div className="flex items-center justify-end gap-2">
                <span
                  className={`text-sm ${hasLock ? "text-green-500" : lockedByOther ? "text-red-500" : "text-gray-600"}`}
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
                    onClick={() => acquireLock({ silent: false })}
                    disabled={lockLoading || stage !== "draft"}
                    className="rounded border border-blue-500 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Acquire
                  </button>
                )}
              </div>
              {lockError ? <span className="text-xs text-red-500">{lockError}</span> : null}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm opacity-80">View:</label>
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={stage}
                onChange={(event) => setStage(event.target.value as "live" | "draft")}
              >
                <option value="live">Live</option>
                <option value="draft">Draft</option>
              </select>
            </div>

            <button
              onClick={() => save()}
              disabled={stage !== "draft" || !isDirty || saving || lockedByOther}
              className={`rounded px-3 py-1 font-semibold focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                stage !== "draft" || !isDirty || saving || lockedByOther
                  ? "cursor-not-allowed bg-gray-300 text-gray-600"
                  : "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-300"
              }`}
              title="Save changes to Draft"
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>

            <button
              onClick={async () => {
                await pullLive();
              }}
              className="rounded border border-blue-500 bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={lockLoading || lockedByOther}
              title="Copy current Live settings into Draft (does not publish)"
            >
              Pull Current Live
            </button>

            <button
              onClick={() => window.open(previewUrl, "_blank")}
              className="rounded border border-neutral-400 bg-neutral-100 px-3 py-1 font-semibold text-neutral-800 hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-neutral-400"
              title="Open the public site with the draft values"
            >
              Preview Draft
            </button>

            <button
              onClick={() => setShowSnapshots(true)}
              className="rounded border border-purple-500 bg-purple-50 px-3 py-1 font-semibold text-purple-700 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-purple-300"
              title="Manage saved draft snapshots"
            >
              Snapshots
            </button>

            <button
              onClick={publish}
              className="rounded bg-yellow-400 px-3 py-1 font-semibold text-black hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={lockLoading || lockedByOther}
              title="Copy the current Draft into Live"
            >
              Publish to Live
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-6 shadow-md">
        <p className="text-sm text-neutral-600">
          Looking for per-page tweaks? Jump over to <span className="font-semibold">Page Configurations</span> from the
          sidebar to adjust individual layouts once your global styles are locked in.
        </p>
      </section>

      <section className="rounded-lg bg-white p-6 shadow-md">
        <AdminSettingsGeneral />
      </section>

      <AdminSettingsSnapshots
        open={showSnapshots}
        onClose={() => setShowSnapshots(false)}
        onRestored={handleSnapshotRestored}
      />
    </div>
  );
}
