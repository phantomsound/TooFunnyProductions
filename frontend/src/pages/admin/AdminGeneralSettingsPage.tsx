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
    <div className="space-y-6 text-neutral-100">
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl space-y-2">
            <h2 className="text-2xl font-semibold text-yellow-300">General Settings</h2>
            <p className="text-sm text-neutral-300">
              Tune the global look and feel of Too Funny Productions. Update the brand copy, upload logos, and manage
              color themes that cascade across every page unless a page override is configured.
            </p>
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
                    onClick={() => acquireLock({ silent: false })}
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
                onChange={(event) => setStage(event.target.value as "live" | "draft")}
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
                onClick={async () => {
                  await pullLive();
                }}
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
                onClick={publish}
                className="rounded bg-yellow-400 px-3 py-1 font-semibold text-black transition hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-200 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={lockLoading || lockedByOther}
                title="Copy the current Draft into Live"
              >
                Publish to Live
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
        <p className="text-sm text-neutral-300">
          Looking for per-page tweaks? Jump over to <span className="font-semibold text-yellow-200">Page Configurations</span>
          from the sidebar to adjust individual layouts once your global styles are locked in.
        </p>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-6 shadow-lg backdrop-blur">
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
