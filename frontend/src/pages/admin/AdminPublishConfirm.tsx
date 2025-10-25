import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type Version = {
  id: string;
  stage: string;
  label: string | null;
  author_email: string | null;
  created_at: string;
  status?: string | null;
};

type AdminPublishConfirmProps = {
  open: boolean;
  draftUpdatedAt?: string | null;
  onClose: () => void;
  onConfirm: (versionId: string | null) => Promise<void> | void;
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

const AdminPublishConfirm: React.FC<AdminPublishConfirmProps> = ({ open, draftUpdatedAt, onClose, onConfirm }) => {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const latestDraftLabel = useMemo(() => {
    if (!draftUpdatedAt) return "Unknown";
    return formatDateTime(draftUpdatedAt);
  }, [draftUpdatedAt]);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api("/api/settings/versions?stage=draft&limit=20"), {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      const list = Array.isArray(data?.versions) ? (data.versions as Version[]) : [];
      setVersions(list);
      setSelectedId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load recent drafts";
      setError(message);
      setVersions([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setConfirmError(null);
    load();
  }, [open, load]);

  if (!open) return null;

  const selectedVersion = versions.find((item) => item.id === selectedId) || null;

  const handleConfirm = async () => {
    setConfirmError(null);
    if (versions.length > 0 && !selectedVersion) {
      setConfirmError("Select the draft snapshot you intend to publish.");
      return;
    }
    if (!acknowledged) {
      setConfirmError("Confirm that you've reviewed the selected draft snapshot.");
      return;
    }
    try {
      setConfirming(true);
      await onConfirm(selectedVersion ? selectedVersion.id : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to publish";
      setConfirmError(message);
      return;
    } finally {
      setConfirming(false);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-3xl rounded-xl bg-neutral-900 text-neutral-100 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          aria-label="Close publish confirmation"
          disabled={confirming}
        >
          ×
        </button>

        <div className="border-b border-neutral-800 px-6 py-4">
          <h3 className="text-lg font-semibold">Publish draft to live</h3>
          <p className="text-xs text-neutral-400">
            Review the most recent saved drafts and confirm you are publishing the correct version.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded border border-neutral-700 bg-neutral-800/50 px-4 py-3 text-sm text-neutral-200">
            <div className="font-semibold text-neutral-100">Current draft status</div>
            <div className="mt-1 text-neutral-300">
              <span className="text-neutral-400">Last updated:</span> {latestDraftLabel}
            </div>
            {selectedVersion ? (
              <div className="mt-2 text-neutral-300">
                <span className="text-neutral-400">Selected snapshot:</span> {selectedVersion.label || "Untitled snapshot"}
                {selectedVersion.created_at ? ` · ${formatDateTime(selectedVersion.created_at)}` : ""}
                {selectedVersion.author_email ? ` · ${selectedVersion.author_email}` : ""}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
          ) : loading ? (
            <div className="py-10 text-center text-sm text-neutral-400">Loading saved drafts…</div>
          ) : versions.length === 0 ? (
            <div className="rounded border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
              No saved draft snapshots were found. Publishing will use the current draft exactly as last updated above.
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto rounded border border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-800/60 text-left text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-3 py-2">Select</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Author</th>
                    <th className="px-3 py-2">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id} className="border-t border-neutral-800">
                      <td className="px-3 py-2 align-top">
                        <input
                          type="radio"
                          name="selected-version"
                          value={version.id}
                          checked={selectedId === version.id}
                          onChange={() => setSelectedId(version.id)}
                          disabled={confirming}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 text-neutral-100">
                        <div className="font-semibold">{version.label || "Untitled snapshot"}</div>
                        {version.status ? (
                          <div className="text-xs text-neutral-500">{version.status}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{formatDateTime(version.created_at)}</td>
                      <td className="px-3 py-2 text-neutral-300">{version.author_email || "—"}</td>
                      <td className="px-3 py-2 text-neutral-300">{stageLabel(version.stage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={confirming}
              className="mt-1 h-4 w-4"
            />
            <span>
              I confirm that I have reviewed the selected draft snapshot and want to publish it to the live site.
            </span>
          </label>

          {confirmError ? (
            <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{confirmError}</div>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={confirming}
              className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming || (versions.length > 0 && !selectedVersion) || !acknowledged}
              className="rounded bg-yellow-400 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirming ? "Publishing…" : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPublishConfirm;
