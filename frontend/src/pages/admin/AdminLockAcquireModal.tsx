import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { AcquireSelection } from "../../lib/SettingsContext";

export type VersionOption = {
  id: string;
  label: string | null;
  note: string | null;
  kind: string | null;
  stage: string | null;
  author_email: string | null;
  created_at: string | null;
  updated_at: string | null;
  published_at?: string | null;
  is_default?: boolean;
};

interface LockOptionsResponse {
  drafts: VersionOption[];
  published: VersionOption[];
  defaultSnapshot: VersionOption | null;
}

interface AdminLockAcquireModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: AcquireSelection) => Promise<void> | void;
}

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const sortVersions = (versions: VersionOption[]) =>
  [...versions].sort((a, b) => {
    const aTime = a.updated_at || a.created_at || "";
    const bTime = b.updated_at || b.created_at || "";
    return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
  });

const AdminLockAcquireModal: React.FC<AdminLockAcquireModalProps> = ({ open, onClose, onSelect }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<VersionOption[]>([]);
  const [published, setPublished] = useState<VersionOption[]>([]);
  const [defaultSnapshot, setDefaultSnapshot] = useState<VersionOption | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newNote, setNewNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadOptions = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api("/api/settings/lock/options"), { credentials: "include" });
      const data: LockOptionsResponse = await response.json();
      if (!response.ok) throw new Error((data as any)?.error || `Request failed: ${response.status}`);
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setPublished(Array.isArray(data.published) ? data.published : []);
      setDefaultSnapshot(data.defaultSnapshot || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load drafts and snapshots";
      setError(message);
      setDrafts([]);
      setPublished([]);
      setDefaultSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void loadOptions();
  }, [open, loadOptions]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setActionLoading(false);
    }
  }, [open]);

  const handleSelect = useCallback(
    async (selection: AcquireSelection) => {
      try {
        setActionLoading(true);
        setError(null);
        await onSelect(selection);
        setActionLoading(false);
        onClose();
      } catch (err) {
        setActionLoading(false);
        const message = err instanceof Error ? err.message : "Failed to acquire draft lock";
        setError(message);
      }
    },
    [onClose, onSelect]
  );

  const sortedDrafts = useMemo(() => sortVersions(drafts), [drafts]);
  const sortedPublished = useMemo(() => sortVersions(published), [published]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-xl bg-white text-neutral-900 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
          aria-label="Close"
        >
          ×
        </button>

        <div className="border-b border-neutral-200 px-6 py-4">
          <h2 className="text-xl font-semibold">Start or resume a draft</h2>
          <p className="text-sm text-neutral-600">
            Pick a saved draft, load a published snapshot, or start fresh from the current live settings.
          </p>
        </div>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Resume a draft</h3>
              <p className="text-xs text-neutral-500">Includes autosaves and drafts created by any admin.</p>
            </div>
            <div className="max-h-72 overflow-y-auto rounded border border-neutral-200">
              {loading ? (
                <div className="py-10 text-center text-sm text-neutral-500">Loading…</div>
              ) : sortedDrafts.length === 0 ? (
                <div className="py-10 text-center text-sm text-neutral-500">No saved drafts yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Draft</th>
                      <th className="px-3 py-2 text-left">Updated</th>
                      <th className="px-3 py-2 text-left">Author</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDrafts.map((draft) => (
                      <tr key={draft.id} className="border-t border-neutral-200">
                        <td className="px-3 py-2">
                          <div className="font-medium text-neutral-900">{draft.label || "Untitled draft"}</div>
                          {draft.note ? <div className="text-xs text-neutral-500">{draft.note}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-sm text-neutral-600">{formatTimestamp(draft.updated_at || draft.created_at)}</td>
                        <td className="px-3 py-2 text-sm text-neutral-600">{draft.author_email || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="rounded border border-blue-500 px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleSelect({ mode: "resume", versionId: draft.id })}
                            disabled={actionLoading}
                          >
                            Resume
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Start from live or snapshot</h3>
              <p className="text-xs text-neutral-500">Clone the current site or a published snapshot into a new working draft.</p>
            </div>

            <div className="space-y-4 rounded border border-neutral-200 p-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">New draft label</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder="e.g. Holiday theme refresh"
                  className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  disabled={actionLoading}
                />
                <textarea
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                  placeholder="Quick note (optional)"
                  className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  disabled={actionLoading}
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      handleSelect({
                        mode: "new",
                        source: "live",
                        label: newLabel.trim() || null,
                        note: newNote.trim() || null,
                      })
                    }
                    disabled={actionLoading}
                  >
                    Start from current live
                  </button>
                  <button
                    className="rounded border border-neutral-400 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      handleSelect({
                        mode: "new",
                        source: "blank",
                        label: newLabel.trim() || null,
                        note: newNote.trim() || null,
                      })
                    }
                    disabled={actionLoading}
                  >
                    Start from blank
                  </button>
                </div>
              </div>

              <div className="border-t border-dashed border-neutral-200 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Published snapshots</h4>
                <div className="max-h-52 overflow-y-auto">
                  {loading ? (
                    <div className="py-6 text-center text-sm text-neutral-500">Loading…</div>
                  ) : sortedPublished.length === 0 ? (
                    <div className="py-6 text-center text-sm text-neutral-500">No published snapshots yet.</div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {sortedPublished.map((snapshot) => (
                        <li key={snapshot.id} className="flex items-center justify-between rounded border border-neutral-200 px-3 py-2">
                          <div>
                            <div className="font-medium text-neutral-900">
                              {snapshot.label || "Untitled snapshot"}
                              {snapshot.is_default ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Default</span> : null}
                            </div>
                            <div className="text-xs text-neutral-500">
                              Last published {formatTimestamp(snapshot.published_at || snapshot.updated_at || snapshot.created_at)}
                            </div>
                            {snapshot.note ? <div className="text-xs text-neutral-500">{snapshot.note}</div> : null}
                          </div>
                          <button
                            className="rounded border border-purple-500 px-3 py-1 text-xs font-semibold text-purple-600 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() =>
                              handleSelect({
                                mode: "snapshot",
                                versionId: snapshot.id,
                                label: newLabel.trim() || snapshot.label || null,
                                note: newNote.trim() || snapshot.note || null,
                              })
                            }
                            disabled={actionLoading}
                          >
                            Load snapshot
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {defaultSnapshot && !sortedPublished.find((snap) => snap.id === defaultSnapshot.id) ? (
                  <div className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Default snapshot: <strong>{defaultSnapshot.label || "Untitled"}</strong>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>

        {error ? (
          <div className="border-t border-red-200 bg-red-50 px-6 py-3 text-sm text-red-600">{error}</div>
        ) : null}

        {actionLoading ? (
          <div className="border-t border-neutral-200 bg-neutral-100 px-6 py-3 text-sm text-neutral-600">Applying selection…</div>
        ) : null}
      </div>
    </div>
  );
};

export default AdminLockAcquireModal;
