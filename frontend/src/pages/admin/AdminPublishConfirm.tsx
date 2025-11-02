import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useSettings } from "../../lib/SettingsContext";

type Version = {
  id: string;
  stage: string;
  label: string | null;
  author_email: string | null;
  created_at: string;
  updated_at?: string | null;
  note?: string | null;
  status?: string | null;
  kind?: string | null;
  published_at?: string | null;
  is_default?: boolean;
};

type Deployment = {
  id: string;
  snapshot_id: string;
  fallback_snapshot_id: string | null;
  start_at: string;
  end_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  cancelled_at?: string | null;
  override_reason?: string | null;
  snapshot?: Version | null;
  fallback_snapshot?: Version | null;
};

type AdminPublishConfirmProps = {
  open: boolean;
  draftUpdatedAt?: string | null;
  onClose: () => void;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const stageLabel = (stage: string | null | undefined) => {
  if (!stage) return "Unknown";
  const normalized = stage.toLowerCase();
  if (normalized === "draft") return "Draft";
  if (normalized === "live") return "Live";
  return stage;
};

const deploymentStatusLabel = (status: string | null | undefined) => {
  if (!status) return "Unknown";
  const normalized = status.toLowerCase();
  if (normalized === "scheduled") return "Scheduled";
  if (normalized === "running") return "Active";
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled") return "Cancelled";
  return status;
};

const AdminPublishConfirm: React.FC<AdminPublishConfirmProps> = ({ open, draftUpdatedAt, onClose }) => {
  const [draftVersions, setDraftVersions] = useState<Version[]>([]);
  const [publishedVersions, setPublishedVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [mode, setMode] = useState<"publish" | "schedule">("publish");
  const [sourceType, setSourceType] = useState<"current" | "draft" | "published">("current");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedPublishedId, setSelectedPublishedId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [setDefault, setSetDefault] = useState(false);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [scheduleSource, setScheduleSource] = useState<"draft" | "published">("draft");
  const [scheduleSnapshotId, setScheduleSnapshotId] = useState<string | null>(null);
  const [fallbackSnapshotId, setFallbackSnapshotId] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [deploymentActionId, setDeploymentActionId] = useState<string | null>(null);

  const latestDraftLabel = useMemo(() => {
    if (!draftUpdatedAt) return "Unknown";
    return formatDateTime(draftUpdatedAt);
  }, [draftUpdatedAt]);

  const selectedPublishSnapshot = useMemo(() => {
    if (sourceType === "draft" && selectedDraftId) {
      return draftVersions.find((version) => version.id === selectedDraftId) || null;
    }
    if (sourceType === "published" && selectedPublishedId) {
      return publishedVersions.find((version) => version.id === selectedPublishedId) || null;
    }
    return null;
  }, [sourceType, selectedDraftId, selectedPublishedId, draftVersions, publishedVersions]);

  const scheduleSnapshot = useMemo(() => {
    if (scheduleSource === "draft" && scheduleSnapshotId) {
      return draftVersions.find((version) => version.id === scheduleSnapshotId) || null;
    }
    if (scheduleSource === "published" && scheduleSnapshotId) {
      return publishedVersions.find((version) => version.id === scheduleSnapshotId) || null;
    }
    return null;
  }, [scheduleSource, scheduleSnapshotId, draftVersions, publishedVersions]);

  const fallbackSnapshot = useMemo(() => {
    if (!fallbackSnapshotId) return null;
    return (
      draftVersions.find((version) => version.id === fallbackSnapshotId) ||
      publishedVersions.find((version) => version.id === fallbackSnapshotId) ||
      null
    );
  }, [fallbackSnapshotId, draftVersions, publishedVersions]);

  const { publish, reload } = useSettings();

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api("/api/settings/versions?limit=60"), {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      const list = Array.isArray(data?.versions) ? (data.versions as Version[]) : [];
      const drafts = list.filter((item) => (item.kind || item.stage) !== "live" && item.kind !== "published");
      const published = list.filter((item) => item.kind === "published" || item.stage === "live");
      setDraftVersions(drafts);
      setPublishedVersions(published);
      setSelectedDraftId((prev) => {
        if (prev && drafts.some((item) => item.id === prev)) return prev;
        return drafts.length > 0 ? drafts[0].id : null;
      });
      setSelectedPublishedId((prev) => {
        if (prev && published.some((item) => item.id === prev)) return prev;
        return published.length > 0 ? published[0].id : null;
      });
      setFallbackSnapshotId((prev) => {
        const combined = [...drafts, ...published];
        if (prev && combined.some((item) => item.id === prev)) return prev;
        const preferred = published.find((item) => item.is_default) || published[0] || null;
        return preferred ? preferred.id : null;
      });
      if (!scheduleSnapshotId && drafts.length > 0) {
        setScheduleSource("draft");
        setScheduleSnapshotId(drafts[0].id);
      } else if (!scheduleSnapshotId && published.length > 0) {
        setScheduleSource("published");
        setScheduleSnapshotId(published[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load recent drafts";
      setError(message);
      setDraftVersions([]);
      setPublishedVersions([]);
      setSelectedDraftId(null);
      setSelectedPublishedId(null);
    } finally {
      setLoading(false);
    }
  }, [open, scheduleSnapshotId, scheduleSource]);

  const loadDeployments = useCallback(async () => {
    if (!open) return;
    setDeploymentsLoading(true);
    setDeployError(null);
    try {
      const response = await fetch(api("/api/settings/deployments"), { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      const items = Array.isArray(data?.deployments) ? (data.deployments as Deployment[]) : [];
      setDeployments(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load deployments";
      setDeployError(message);
      setDeployments([]);
    } finally {
      setDeploymentsLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setConfirmError(null);
    load();
    loadDeployments();
    setLabel("");
    setNote("");
    setSetDefault(false);
    setScheduleMessage(null);
  }, [open, load, loadDeployments]);

  useEffect(() => {
    if (!open) return;
    if (sourceType === "current") {
      setLabel("");
      setNote("");
      return;
    }
    if (selectedPublishSnapshot) {
      setLabel(selectedPublishSnapshot.label || "");
      setNote(selectedPublishSnapshot.note || "");
    }
  }, [open, sourceType, selectedPublishSnapshot]);

  const publishSelectionValid = useMemo(() => {
    if (sourceType === "current") return true;
    if (sourceType === "draft") return Boolean(selectedDraftId);
    if (sourceType === "published") return Boolean(selectedPublishedId);
    return false;
  }, [sourceType, selectedDraftId, selectedPublishedId]);

  const scheduleSelectionValid = useMemo(() => Boolean(scheduleSnapshotId && scheduleStart), [scheduleSnapshotId, scheduleStart]);

  const renderVersionTable = useCallback(
    (versions: Version[], selectedId: string | null, onSelect: (id: string) => void, groupName: string) => {
      if (versions.length === 0) {
        return (
          <div className="rounded border border-neutral-700 bg-neutral-800/40 px-3 py-2 text-sm text-neutral-300">
            No snapshots available.
          </div>
        );
      }

      return (
        <div className="max-h-72 overflow-y-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-800/60 text-left text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-3 py-2">Select</th>
                <th className="px-3 py-2">Snapshot</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Author</th>
                <th className="px-3 py-2">Stage</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => {
                const radioId = `${groupName}-${version.id}`;
                return (
                  <tr key={version.id} className="border-t border-neutral-800">
                    <td className="px-3 py-2 align-top">
                      <input
                        id={radioId}
                        type="radio"
                        name={groupName}
                        value={version.id}
                        checked={selectedId === version.id}
                        onChange={() => onSelect(version.id)}
                        disabled={confirming}
                        className="h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 text-neutral-100">
                      <label htmlFor={radioId} className="block cursor-pointer">
                        <div className="font-semibold">
                          {version.label || "Untitled snapshot"}
                        </div>
                        {version.note ? (
                          <div className="text-xs text-neutral-400">{version.note}</div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-neutral-400">
                          {version.kind ? <span className="rounded border border-neutral-600 px-2 py-0.5">{version.kind}</span> : null}
                          {version.is_default ? (
                            <span className="rounded border border-yellow-500/60 px-2 py-0.5 text-yellow-300">Default revert</span>
                          ) : null}
                        </div>
                      </label>
                    </td>
                    <td className="px-3 py-2 text-neutral-300">{formatDateTime(version.updated_at || version.created_at)}</td>
                    <td className="px-3 py-2 text-neutral-300">{version.author_email || "—"}</td>
                    <td className="px-3 py-2 text-neutral-300">{stageLabel(version.stage || version.kind)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    },
    [confirming]
  );

  const renderDeployments = () => {
    if (deploymentsLoading) {
      return <div className="py-6 text-center text-sm text-neutral-400">Loading deployment schedule…</div>;
    }
    if (deployError) {
      return (
        <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {deployError}
        </div>
      );
    }
    if (deployments.length === 0) {
      return (
        <div className="rounded border border-neutral-700 bg-neutral-800/40 px-3 py-2 text-sm text-neutral-300">
          No deployments are currently scheduled.
        </div>
      );
    }
    return (
      <div className="max-h-72 overflow-y-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-800/60 text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2">Snapshot</th>
              <th className="px-3 py-2">Window</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Fallback</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => {
              const status = deployment.status ? deployment.status.toLowerCase() : "";
              const disableActions = confirming || deploymentActionId === deployment.id;
              const canCancel = status === "scheduled" || status === "running";
              const canOverride = status === "running";
              return (
                <tr key={deployment.id} className="border-t border-neutral-800">
                  <td className="px-3 py-2 text-neutral-100">
                    <div className="font-semibold">{deployment.snapshot?.label || "Untitled snapshot"}</div>
                    {deployment.snapshot?.note ? (
                      <div className="text-xs text-neutral-400">{deployment.snapshot.note}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    <div>Start: {formatDateTime(deployment.start_at)}</div>
                    <div>End: {deployment.end_at ? formatDateTime(deployment.end_at) : "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    <div>{deploymentStatusLabel(deployment.status)}</div>
                    <div className="text-xs text-neutral-500">Updated {formatDateTime(deployment.updated_at)}</div>
                    {deployment.cancelled_at ? (
                      <div className="text-xs text-red-300">Cancelled {formatDateTime(deployment.cancelled_at)}</div>
                    ) : null}
                    {deployment.override_reason ? (
                      <div className="text-xs text-yellow-300">Override: {deployment.override_reason}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    {deployment.fallback_snapshot?.label
                      ? deployment.fallback_snapshot.label
                      : deployment.fallback_snapshot_id
                      ? deployment.fallback_snapshot_id
                      : "Default snapshot"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {canCancel ? (
                        <button
                          onClick={() => promptCancelDeployment(deployment)}
                          disabled={disableActions}
                          className="rounded border border-red-500/60 px-2 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      ) : null}
                      {canOverride ? (
                        <button
                          onClick={() => promptOverrideDeployment(deployment)}
                          disabled={disableActions}
                          className="rounded border border-yellow-400/60 px-2 py-1 text-xs font-semibold text-yellow-200 transition hover:bg-yellow-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Override
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  if (!open) return null;

  const confirmDisabled = mode === "publish"
    ? confirming || !acknowledged || !publishSelectionValid
    : confirming || !scheduleSelectionValid;
  const confirmLabel = mode === "publish" ? (confirming ? "Publishing…" : "Publish now") : confirming ? "Scheduling…" : "Schedule deployment";

  const handleConfirm = async () => {
    setConfirmError(null);
    setScheduleMessage(null);
    if (mode === "publish") {
      if (!acknowledged) {
        setConfirmError("Confirm that you've reviewed the selected draft before publishing.");
        return;
      }

      let snapshotId: string | null = null;
      if (sourceType === "draft") {
        if (!selectedDraftId) {
          setConfirmError("Select a draft snapshot to publish.");
          return;
        }
        snapshotId = selectedDraftId;
      } else if (sourceType === "published") {
        if (!selectedPublishedId) {
          setConfirmError("Select a published snapshot to deploy.");
          return;
        }
        snapshotId = selectedPublishedId;
      }

      try {
        setConfirming(true);
        await publish({
          snapshotId,
          label: label.trim() || null,
          note: note.trim() || null,
          setDefault,
        });
        await reload();
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to publish";
        setConfirmError(message);
      } finally {
        setConfirming(false);
      }
      return;
    }

    // scheduling path
    if (!scheduleSnapshotId) {
      setConfirmError("Select a snapshot to schedule.");
      return;
    }
    if (!scheduleStart) {
      setConfirmError("Provide a start date and time for the deployment.");
      return;
    }
    const start = new Date(scheduleStart);
    if (Number.isNaN(start.getTime())) {
      setConfirmError("Start time is invalid.");
      return;
    }
    let endIso: string | null = null;
    if (scheduleEnd) {
      const end = new Date(scheduleEnd);
      if (Number.isNaN(end.getTime())) {
        setConfirmError("End time is invalid.");
        return;
      }
      if (end <= start) {
        setConfirmError("End time must be after the start time.");
        return;
      }
      endIso = end.toISOString();
    }

    const payload = {
      snapshotId: scheduleSnapshotId,
      startAt: start.toISOString(),
      endAt: endIso,
      fallbackSnapshotId,
    };

    try {
      setConfirming(true);
      const response = await fetch(api("/api/settings/deployments"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setScheduleMessage("Deployment scheduled successfully.");
      await loadDeployments();
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to schedule deployment";
      setConfirmError(message);
    } finally {
      setConfirming(false);
    }
  };

  const cancelDeployment = useCallback(
    async (deploymentId: string, applyFallback: boolean) => {
      setScheduleMessage(null);
      setConfirmError(null);
      setDeploymentActionId(deploymentId);
      try {
        const response = await fetch(api(`/api/settings/deployments/${deploymentId}/cancel`), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applyFallback }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Failed to cancel deployment");
        await loadDeployments();
        await reload();
        setScheduleMessage(applyFallback ? "Deployment cancelled and fallback applied." : "Deployment cancelled.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to cancel deployment";
        setConfirmError(message);
      } finally {
        setDeploymentActionId(null);
      }
    },
    [loadDeployments, reload]
  );

  const overrideDeployment = useCallback(
    async (deploymentId: string, reason: string) => {
      setScheduleMessage(null);
      setConfirmError(null);
      setDeploymentActionId(deploymentId);
      try {
        const response = await fetch(api(`/api/settings/deployments/${deploymentId}/override`), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Failed to override deployment");
        await loadDeployments();
        await reload();
        setScheduleMessage("Deployment schedule overridden.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to override deployment";
        setConfirmError(message);
      } finally {
        setDeploymentActionId(null);
      }
    },
    [loadDeployments, reload]
  );

  const promptCancelDeployment = useCallback(
    async (deployment: Deployment) => {
      const label = deployment.snapshot?.label || "Snapshot";
      const startLabel = formatDateTime(deployment.start_at);
      const confirm = window.confirm(
        `Cancel the deployment of "${label}" scheduled for ${startLabel}? This will stop the scheduled swap.`
      );
      if (!confirm) return;
      let applyFallback = false;
      if (deployment.status === "running" || deployment.fallback_snapshot_id) {
        applyFallback = window.confirm(
          "Apply the designated fallback snapshot (or default) to live after cancelling?"
        );
      }
      await cancelDeployment(deployment.id, applyFallback);
    },
    [cancelDeployment]
  );

  const promptOverrideDeployment = useCallback(
    async (deployment: Deployment) => {
      const label = deployment.snapshot?.label || "Snapshot";
      const confirm = window.confirm(
        `Override the active schedule for "${label}"? This will immediately close out the schedule and require a manual publish.`
      );
      if (!confirm) return;
      const defaultReason = `Manual override by admin (${new Date().toLocaleString()})`;
      const reason = window.prompt("Add a quick note for the audit log:", defaultReason);
      if (reason === null) return;
      const trimmed = reason.trim() || defaultReason;
      await overrideDeployment(deployment.id, trimmed);
    },
    [overrideDeployment]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-4xl rounded-xl bg-neutral-900 text-neutral-100 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          aria-label="Close publish confirmation"
          disabled={confirming}
        >
          ×
        </button>

        <div className="border-b border-neutral-800 px-6 py-4">
          <h3 className="text-lg font-semibold">Deploy snapshots to live</h3>
          <p className="text-xs text-neutral-400">
            Choose whether to push the current draft immediately or schedule a saved snapshot for later.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMode("publish")}
              className={`rounded px-3 py-1 text-sm font-semibold transition ${
                mode === "publish"
                  ? "bg-yellow-400 text-black hover:bg-yellow-300"
                  : "border border-neutral-700 bg-neutral-800/40 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Publish now
            </button>
            <button
              onClick={() => setMode("schedule")}
              className={`rounded px-3 py-1 text-sm font-semibold transition ${
                mode === "schedule"
                  ? "bg-yellow-400 text-black hover:bg-yellow-300"
                  : "border border-neutral-700 bg-neutral-800/40 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Schedule deployment
            </button>
          </div>

          <div className="rounded border border-neutral-700 bg-neutral-800/50 px-4 py-3 text-sm text-neutral-200">
            <div className="font-semibold text-neutral-100">Current draft status</div>
            <div className="mt-1 text-neutral-300">
              <span className="text-neutral-400">Last updated:</span> {latestDraftLabel}
            </div>
            {mode === "publish" && sourceType !== "current" && selectedPublishSnapshot ? (
              <div className="mt-2 text-neutral-300">
                <span className="text-neutral-400">Publishing snapshot:</span> {selectedPublishSnapshot.label || "Untitled snapshot"}
                {selectedPublishSnapshot.updated_at ? ` · ${formatDateTime(selectedPublishSnapshot.updated_at)}` : ""}
              </div>
            ) : null}
            {mode === "schedule" && scheduleSnapshot ? (
              <div className="mt-2 text-neutral-300">
                <span className="text-neutral-400">Scheduled snapshot:</span> {scheduleSnapshot.label || "Untitled snapshot"}
                {scheduleSnapshot.updated_at ? ` · ${formatDateTime(scheduleSnapshot.updated_at)}` : ""}
              </div>
            ) : null}
          </div>

          {mode === "publish" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 text-sm text-neutral-200">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="current"
                    checked={sourceType === "current"}
                    onChange={() => setSourceType("current")}
                    disabled={confirming}
                  />
                  Publish the current draft as-is
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="draft"
                    checked={sourceType === "draft"}
                    onChange={() => setSourceType("draft")}
                    disabled={confirming || draftVersions.length === 0}
                  />
                  Publish from saved draft snapshot
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="published"
                    checked={sourceType === "published"}
                    onChange={() => setSourceType("published")}
                    disabled={confirming || publishedVersions.length === 0}
                  />
                  Revert to previously published snapshot
                </label>
              </div>

              {sourceType === "current" ? (
                <div className="rounded border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
                  The current draft will be published. Consider adding a label and note below so it is easy to find later.
                </div>
              ) : loading ? (
                <div className="py-8 text-center text-sm text-neutral-400">Loading saved snapshots…</div>
              ) : error ? (
                <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
              ) : sourceType === "draft" ? (
                renderVersionTable(draftVersions, selectedDraftId, (id) => setSelectedDraftId(id), "publish-draft")
              ) : (
                renderVersionTable(publishedVersions, selectedPublishedId, (id) => setSelectedPublishedId(id), "publish-published")
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col text-sm text-neutral-200">
                  <span className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Snapshot label (optional)</span>
                  <input
                    type="text"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    disabled={confirming}
                    className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-300"
                    placeholder="Holiday launch"
                  />
                </label>
                <label className="flex flex-col text-sm text-neutral-200 sm:col-span-1">
                  <span className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Quick note (optional)</span>
                  <input
                    type="text"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={confirming}
                    className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-300"
                    placeholder="Includes seasonal hero art"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  checked={setDefault}
                  onChange={(event) => setSetDefault(event.target.checked)}
                  disabled={confirming}
                />
                Mark this snapshot as the default emergency revert once published
              </label>

              <label className="flex items-start gap-2 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={confirming}
                  className="mt-1 h-4 w-4"
                />
                <span>I confirm that I have reviewed the snapshot and want to make it live.</span>
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded border border-neutral-700 bg-neutral-800/40 px-3 py-2 text-sm text-neutral-200">
                Scheduled deployments cannot overlap. Set the start and end window, and choose a fallback snapshot that will auto-restore when the window closes.
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-neutral-200">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="draft"
                    checked={scheduleSource === "draft"}
                    onChange={() => setScheduleSource("draft")}
                    disabled={confirming || draftVersions.length === 0}
                  />
                  Schedule a draft snapshot
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="published"
                    checked={scheduleSource === "published"}
                    onChange={() => setScheduleSource("published")}
                    disabled={confirming || publishedVersions.length === 0}
                  />
                  Schedule a published snapshot
                </label>
              </div>

              {loading ? (
                <div className="py-8 text-center text-sm text-neutral-400">Loading snapshots…</div>
              ) : error ? (
                <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
              ) : scheduleSource === "draft" ? (
                renderVersionTable(draftVersions, scheduleSnapshotId, (id) => setScheduleSnapshotId(id), "schedule-draft")
              ) : (
                renderVersionTable(publishedVersions, scheduleSnapshotId, (id) => setScheduleSnapshotId(id), "schedule-published")
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col text-sm text-neutral-200">
                  <span className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Start time</span>
                  <input
                    type="datetime-local"
                    value={scheduleStart}
                    onChange={(event) => setScheduleStart(event.target.value)}
                    disabled={confirming}
                    className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-300"
                  />
                </label>
                <label className="flex flex-col text-sm text-neutral-200">
                  <span className="mb-1 text-xs uppercase tracking-wide text-neutral-400">End time (optional)</span>
                  <input
                    type="datetime-local"
                    value={scheduleEnd}
                    onChange={(event) => setScheduleEnd(event.target.value)}
                    disabled={confirming}
                    className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-300"
                  />
                </label>
              </div>

              <div className="rounded border border-neutral-700 bg-neutral-800/40 px-4 py-3 text-sm text-neutral-200">
                <div className="font-semibold text-neutral-100">Fallback snapshot</div>
                <p className="mt-1 text-neutral-300">
                  When the schedule completes or is cancelled, the site will revert to the fallback snapshot (or the default snapshot if none is selected).
                </p>
                <select
                  value={fallbackSnapshotId || ""}
                  onChange={(event) => setFallbackSnapshotId(event.target.value ? event.target.value : null)}
                  disabled={confirming}
                  className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-300"
                >
                  <option value="">Use default snapshot</option>
                  {publishedVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label || "Untitled snapshot"}
                      {version.is_default ? " • Default" : ""}
                    </option>
                  ))}
                  {draftVersions
                    .filter((version) => !publishedVersions.some((item) => item.id === version.id))
                    .map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.label || "Untitled snapshot"} (draft)
                      </option>
                    ))}
                </select>
                <div className="mt-2 text-xs text-neutral-400">
                  {fallbackSnapshot
                    ? `Fallback currently set to ${fallbackSnapshot.label || "Untitled snapshot"}.`
                    : "Fallback will use the designated default snapshot."}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-neutral-200">Scheduled deployments</div>
                {scheduleMessage ? (
                  <div className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    {scheduleMessage}
                  </div>
                ) : null}
                {renderDeployments()}
              </div>
            </div>
          )}

          {confirmError ? (
            <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{confirmError}</div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-neutral-800 pt-4">
            <button
              onClick={onClose}
              disabled={confirming}
              className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Close
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className="rounded bg-yellow-400 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPublishConfirm;
