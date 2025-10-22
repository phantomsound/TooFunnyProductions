import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Snapshot {
  id: string;
  stage: string;
  label: string | null;
  author_email: string | null;
  created_at: string;
  status?: string | null;
}

interface AdminSettingsSnapshotsProps {
  open: boolean;
  onClose: () => void;
  onRestored: () => Promise<void> | void;
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const AdminSettingsSnapshots: React.FC<AdminSettingsSnapshotsProps> = ({ open, onClose, onRestored }) => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api("/api/settings/versions?limit=20"), {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setSnapshots(Array.isArray(data.versions) ? data.versions : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load snapshots";
      setError(message);
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const createSnapshot = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(api("/api/settings/versions"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null, stage: "draft" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setLabel("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create snapshot";
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  const restoreSnapshot = async (id: string) => {
    const confirm = window.confirm("Restore this snapshot to the draft settings? This will overwrite the current draft.");
    if (!confirm) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api(`/api/settings/versions/${id}/restore`), {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      await onRestored();
      onClose();
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to restore snapshot";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const deleteSnapshot = async (id: string) => {
    const confirm = window.confirm("Delete this snapshot permanently? This action cannot be undone.");
    if (!confirm) return;
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(api(`/api/settings/versions/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setSnapshots((prev) => prev.filter((snapshot) => snapshot.id !== id));
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete snapshot";
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-3xl rounded-xl bg-neutral-900 text-neutral-100 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          aria-label="Close snapshots"
        >
          ×
        </button>

        <div className="border-b border-neutral-800 px-6 py-4">
          <h3 className="text-lg font-semibold">Draft snapshots</h3>
          <p className="text-xs text-neutral-400">
            Save checkpoints of the draft settings so you can roll back or review previous edits.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional label (e.g. 'Homepage refresh')"
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-yellow-400 focus:outline-none"
              disabled={creating}
            />
            <button
              onClick={createSnapshot}
              disabled={creating}
              className="rounded bg-yellow-400 px-3 py-2 text-sm font-semibold text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Saving…" : "Save snapshot"}
            </button>
          </div>

          {error ? (
            <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
          ) : null}

          {loading ? (
            <div className="py-10 text-center text-sm text-neutral-400">Loading snapshots…</div>
          ) : snapshots.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">No snapshots yet.</div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Author</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => (
                    <tr key={snapshot.id} className="border-t border-neutral-800">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-neutral-100">{snapshot.label || "Untitled snapshot"}</div>
                        <div className="text-xs text-neutral-500">Stage: {snapshot.stage}</div>
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{formatDate(snapshot.created_at)}</td>
                      <td className="px-3 py-2 text-neutral-400">{snapshot.author_email || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => restoreSnapshot(snapshot.id)}
                            className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={loading || creating || deletingId === snapshot.id}
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => deleteSnapshot(snapshot.id)}
                            className="rounded border border-red-500/60 px-3 py-1 text-xs text-red-200 transition hover:border-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={loading || creating || deletingId === snapshot.id}
                          >
                            {deletingId === snapshot.id ? "Removing…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSettingsSnapshots;
