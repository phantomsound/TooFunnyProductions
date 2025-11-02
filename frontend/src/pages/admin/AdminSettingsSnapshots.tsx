import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

interface Snapshot {
  id: string;
  stage: string;
  label: string | null;
  author_email: string | null;
  created_at: string;
  status?: string | null;
  note?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  kind?: string | null;
  is_default?: boolean;
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
  const [draftSnapshots, setDraftSnapshots] = useState<Snapshot[]>([]);
  const [publishedSnapshots, setPublishedSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api("/api/settings/versions?limit=40"), {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      const versions = Array.isArray(data.versions) ? (data.versions as Snapshot[]) : [];
      const drafts = versions.filter((snapshot) => (snapshot.kind || snapshot.stage) !== "live" && snapshot.kind !== "published");
      const published = versions.filter((snapshot) => snapshot.kind === "published" || snapshot.stage === "live");
      setDraftSnapshots(drafts);
      setPublishedSnapshots(published);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load snapshots";
      setError(message);
      setDraftSnapshots([]);
      setPublishedSnapshots([]);
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
        body: JSON.stringify({ label: label.trim() || null, note: note.trim() || null, stage: "draft" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setLabel("");
      setNote("");
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
      setDraftSnapshots((prev) => prev.filter((snapshot) => snapshot.id !== id));
      setPublishedSnapshots((prev) => prev.filter((snapshot) => snapshot.id !== id));
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete snapshot";
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const editSnapshot = async (id: string) => {
    const existing = [...draftSnapshots, ...publishedSnapshots].find((snapshot) => snapshot.id === id);
    if (!existing) return;
    const nextLabel = window.prompt("Update snapshot label", existing.label || "")?.trim();
    if (nextLabel === undefined || nextLabel === null) return;
    const nextNoteRaw = window.prompt("Update quick note", existing.note || "");
    if (nextNoteRaw === null) return;
    const nextNote = nextNoteRaw.trim();

    try {
      const response = await fetch(api(`/api/settings/versions/${id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nextLabel.length > 0 ? nextLabel : null, note: nextNote.length > 0 ? nextNote : null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setDraftSnapshots((prev) => prev.map((snapshot) => (snapshot.id === id ? { ...snapshot, label: nextLabel || null, note: nextNote || null } : snapshot)));
      setPublishedSnapshots((prev) => prev.map((snapshot) => (snapshot.id === id ? { ...snapshot, label: nextLabel || null, note: nextNote || null } : snapshot)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update snapshot";
      setError(message);
    }
  };

  const sortedDrafts = useMemo(
    () =>
      [...draftSnapshots].sort((a, b) => {
        const aTime = a.updated_at || a.created_at || "";
        const bTime = b.updated_at || b.created_at || "";
        return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
      }),
    [draftSnapshots]
  );

  const sortedPublished = useMemo(
    () =>
      [...publishedSnapshots].sort((a, b) => {
        const aTime = a.published_at || a.updated_at || a.created_at || "";
        const bTime = b.published_at || b.updated_at || b.created_at || "";
        return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
      }),
    [publishedSnapshots]
  );

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
          <div className="grid gap-3 md:grid-cols-[2fr,1fr] md:items-start">
            <div className="space-y-2">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Snapshot label (e.g. 'Homepage refresh')"
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-yellow-400 focus:outline-none"
                disabled={creating}
              />
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Quick note (optional)"
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-yellow-400 focus:outline-none"
                rows={2}
                disabled={creating}
              />
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                onClick={createSnapshot}
                disabled={creating}
                className="rounded bg-yellow-400 px-3 py-2 text-sm font-semibold text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Saving…" : "Save snapshot"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
          ) : null}

          {loading ? (
            <div className="py-10 text-center text-sm text-neutral-400">Loading snapshots…</div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-2">
                <header>
                  <h3 className="text-sm font-semibold text-neutral-100">Draft snapshots</h3>
                  <p className="text-xs text-neutral-500">Keep up to 20 saved drafts for works-in-progress.</p>
                </header>
                {sortedDrafts.length === 0 ? (
                  <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-4 text-sm text-neutral-500">
                    No draft snapshots yet.
                  </div>
                ) : (
                  <div className="max-h-[260px] overflow-y-auto rounded border border-neutral-800">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-400">
                        <tr>
                          <th className="px-3 py-2">Label</th>
                          <th className="px-3 py-2">Updated</th>
                          <th className="px-3 py-2">Author</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDrafts.map((snapshot) => (
                          <tr key={snapshot.id} className="border-t border-neutral-800">
                            <td className="px-3 py-2">
                              <div className="font-semibold text-neutral-100">{snapshot.label || "Untitled snapshot"}</div>
                              {snapshot.note ? <div className="text-xs text-neutral-500">{snapshot.note}</div> : null}
                            </td>
                            <td className="px-3 py-2 text-neutral-400">{formatDate(snapshot.updated_at || snapshot.created_at)}</td>
                            <td className="px-3 py-2 text-neutral-400">{snapshot.author_email || "—"}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => editSnapshot(snapshot.id)}
                                  className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={loading || creating || deletingId === snapshot.id}
                                >
                                  Edit
                                </button>
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
              </section>

              <section className="space-y-2">
                <header>
                  <h3 className="text-sm font-semibold text-neutral-100">Published snapshots</h3>
                  <p className="text-xs text-neutral-500">Latest deployments, capped at 10 for quick rollback.</p>
                </header>
                {sortedPublished.length === 0 ? (
                  <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-4 text-sm text-neutral-500">
                    No published snapshots yet.
                  </div>
                ) : (
                  <div className="max-h-[260px] overflow-y-auto rounded border border-neutral-800">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-400">
                        <tr>
                          <th className="px-3 py-2">Snapshot</th>
                          <th className="px-3 py-2">Published</th>
                          <th className="px-3 py-2">Author</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPublished.map((snapshot) => (
                          <tr key={snapshot.id} className="border-t border-neutral-800">
                            <td className="px-3 py-2">
                              <div className="font-semibold text-neutral-100">
                                {snapshot.label || "Untitled snapshot"}
                                {snapshot.is_default ? (
                                  <span className="ml-2 rounded bg-amber-200/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                                    Default
                                  </span>
                                ) : null}
                              </div>
                              {snapshot.note ? <div className="text-xs text-neutral-500">{snapshot.note}</div> : null}
                            </td>
                            <td className="px-3 py-2 text-neutral-400">{formatDate(snapshot.published_at || snapshot.updated_at)}</td>
                            <td className="px-3 py-2 text-neutral-400">{snapshot.author_email || "—"}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => editSnapshot(snapshot.id)}
                                  className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={loading || creating || deletingId === snapshot.id}
                                >
                                  Edit
                                </button>
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
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSettingsSnapshots;
