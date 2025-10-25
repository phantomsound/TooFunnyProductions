import React from "react";
import { api } from "../../lib/api";

type ContactResponse = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  email: string;
  message: string;
  responded: boolean;
  responded_at: string | null;
  responded_by: string | null;
  notes: string;
  delivery_status: string | null;
  delivery_error: string | null;
};

type FetchPayload = {
  items: ContactResponse[];
  total: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
};

const SORT_LABEL = {
  newest: "Newest",
  oldest: "Oldest",
};

export default function AdminContactResponses() {
  const [rows, setRows] = React.useState<ContactResponse[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sort, setSort] = React.useState<keyof typeof SORT_LABEL>("newest");
  const [limit, setLimit] = React.useState("50");
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [editingNotesId, setEditingNotesId] = React.useState<string | null>(null);
  const [notesDraft, setNotesDraft] = React.useState("");
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [showPendingList, setShowPendingList] = React.useState(false);
  const pendingListRef = React.useRef<HTMLDivElement | null>(null);

  const openResponses = React.useMemo(() => rows.filter((item) => !item.responded), [rows]);

  const buildQuery = React.useCallback(
    (format?: string) => {
      const params = new URLSearchParams();
      params.set("limit", limit);
      params.set("sort", sort);
      if (search.trim()) params.set("q", search.trim());
      if (statusFilter === "open") params.set("responded", "false");
      if (statusFilter === "responded") params.set("responded", "true");
      if (format) params.set("format", format);
      return params;
    },
    [limit, sort, search, statusFilter]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildQuery();
      const response = await fetch(api(`/api/admin/contact-responses?${params.toString()}`), {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 403) throw new Error("You do not have access to contact responses.");
        throw new Error(`Request failed: ${response.status}`);
      }
      const payload: FetchPayload = await response.json();
      setRows(payload.items || []);
      setTotal(payload.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contact responses");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [buildQuery, refreshKey]);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(handle);
  }, [load]);

  const refresh = () => setRefreshKey((key) => key + 1);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setSort("newest");
    setLimit("50");
  };

  React.useEffect(() => {
    if (!showPendingList) return;
    const handleClickAway = (event: MouseEvent) => {
      if (!pendingListRef.current) return;
      if (event.target instanceof Node && !pendingListRef.current.contains(event.target)) {
        setShowPendingList(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowPendingList(false);
    };
    document.addEventListener("mousedown", handleClickAway);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickAway);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showPendingList]);

  React.useEffect(() => {
    if (openResponses.length === 0) {
      setShowPendingList(false);
    }
  }, [openResponses.length]);

  const toggleResponded = async (row: ContactResponse) => {
    setSavingId(row.id);
    setError(null);
    try {
      const response = await fetch(api(`/api/admin/contact-responses/${row.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ responded: !row.responded }),
      });
      if (!response.ok) throw new Error(`Failed to update response (${response.status})`);
      const payload = await response.json();
      const updated: ContactResponse = payload.item;
      setRows((prev) => prev.map((item) => (item.id === row.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update response");
    } finally {
      setSavingId(null);
    }
  };

  const startEditingNotes = (row: ContactResponse) => {
    setEditingNotesId(row.id);
    setNotesDraft(row.notes || "");
  };

  const cancelEditing = () => {
    setEditingNotesId(null);
    setNotesDraft("");
  };

  const saveNotes = async (row: ContactResponse) => {
    setSavingId(row.id);
    setError(null);
    try {
      const response = await fetch(api(`/api/admin/contact-responses/${row.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notes: notesDraft }),
      });
      if (!response.ok) throw new Error(`Failed to save notes (${response.status})`);
      const payload = await response.json();
      const updated: ContactResponse = payload.item;
      setRows((prev) => prev.map((item) => (item.id === row.id ? updated : item)));
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSavingId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = buildQuery("csv");
      const response = await fetch(api(`/api/admin/contact-responses?${params.toString()}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Failed to export (${response.status})`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contact-responses-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export contact responses");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 text-gray-900">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">Contact Responses</h2>
            {openResponses.length > 0 ? (
              <div className="relative" ref={pendingListRef}>
                <button
                  type="button"
                  onClick={() => setShowPendingList((open) => !open)}
                  className="flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 shadow-sm transition hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white"
                  aria-haspopup="dialog"
                  aria-expanded={showPendingList}
                >
                  <span className="tf-notice-pulse flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold uppercase tracking-wide text-white shadow">{openResponses.length}</span>
                  <span>Awaiting reply</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-3 w-3 transition-transform ${showPendingList ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.939l3.71-3.71a.75.75 0 111.06 1.061l-4.24 4.24a.75.75 0 01-1.06 0l-4.24-4.24a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {showPendingList ? (
                  <div className="absolute left-0 z-20 mt-2 w-80 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-orange-200 bg-white p-3 text-left text-orange-900 shadow-xl">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-orange-600">
                      <span>Awaiting response</span>
                      <button
                        type="button"
                        onClick={() => setShowPendingList(false)}
                        className="rounded px-2 py-1 text-[10px] font-semibold text-orange-500 transition hover:bg-orange-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      >
                        Close
                      </button>
                    </div>
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {openResponses.map((pending) => (
                        <div
                          key={pending.id}
                          className="rounded border border-orange-100 bg-orange-50 p-2 text-xs shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-orange-900">{pending.name || "(unknown)"}</span>
                            <span className="text-[10px] font-medium text-orange-600/80">
                              {new Date(pending.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-[11px] text-orange-600">{pending.email}</div>
                          <p
                            className="mt-1 text-[11px] text-orange-700/80"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {pending.message}
                          </p>
                          {pending.notes ? (
                            <div className="mt-2 rounded border border-orange-100 bg-white/80 p-2 text-[10px] text-orange-700">
                              <div className="font-semibold uppercase tracking-wide text-[9px] text-orange-500">Notes</div>
                              <div className="mt-1 whitespace-pre-wrap">{pending.notes}</div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="text-sm text-gray-500">
            Track every form submission and mark when your team has responded.
          </p>
          <p className="text-xs text-gray-500">{total} total submissions.</p>
          <p className={`text-xs font-medium ${openResponses.length === 0 ? "text-emerald-600" : "text-orange-600"}`}>
            {openResponses.length === 0
              ? "All responses have been marked as handled."
              : openResponses.length === 1
              ? "1 response is awaiting attention."
              : `${openResponses.length} responses are awaiting attention.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-sky-600 bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded border border-emerald-600 bg-emerald-500 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={exporting || loading}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 shadow-sm transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              search === "" && statusFilter === "all" && sort === "newest" && limit === "50"
            }
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded border bg-white p-4 text-sm md:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name, email, message"
            className="rounded border px-3 py-2 text-black"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Status</span>
          <select
            className="rounded border px-3 py-2 text-black"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All submissions</option>
            <option value="open">Awaiting response</option>
            <option value="responded">Marked responded</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Limit</span>
          <select
            className="rounded border px-3 py-2 text-black"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          >
            {["25", "50", "100", "200", "500"].map((opt) => (
              <option key={opt} value={opt}>
                Show {opt}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Order</span>
          <select
            className="rounded border px-3 py-2 text-black"
            value={sort}
            onChange={(e) => setSort(e.target.value as keyof typeof SORT_LABEL)}
          >
            {Object.entries(SORT_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500">No contact submissions yet.</div>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">Message</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    <div>{new Date(row.created_at).toLocaleString()}</div>
                    {row.responded && row.responded_at ? (
                      <div className="text-[11px] text-gray-400">
                        Responded {new Date(row.responded_at).toLocaleString()} by {row.responded_by || "unknown"}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.name || "(unknown)"}</div>
                    <div className="text-xs text-sky-700">{row.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <pre className="max-h-48 whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700">
                      {row.message}
                    </pre>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-1 font-semibold ${
                          row.delivery_status === "failed"
                            ? "bg-red-100 text-red-700"
                            : row.delivery_status === "sent"
                            ? "bg-emerald-100 text-emerald-700"
                            : row.delivery_status === "skipped"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {STATUS_LABEL[row.delivery_status ?? ""] || "Pending"}
                      </span>
                      {row.delivery_error ? (
                        <span className="text-[11px] text-red-600">{row.delivery_error}</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                        row.responded
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {row.responded ? "Responded" : "Awaiting reply"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {editingNotesId === row.id ? (
                      <div className="space-y-2">
                        <textarea
                          className="w-full rounded border px-3 py-2 text-sm text-black"
                          rows={3}
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          placeholder="Add internal notes"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveNotes(row)}
                            className="rounded border border-emerald-600 bg-emerald-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={savingId === row.id}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : row.notes ? (
                      <div className="space-y-1">
                        <div className="rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700 whitespace-pre-wrap break-words">
                          {row.notes}
                        </div>
                        <button
                          type="button"
                          onClick={() => startEditingNotes(row)}
                          className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 shadow-sm transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                        >
                          Edit notes
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditingNotes(row)}
                        className="rounded border border-dashed border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-500 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                      >
                        Add notes
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleResponded(row)}
                      className="rounded border px-2 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={savingId === row.id}
                      style={{
                        borderColor: row.responded ? "#f97316" : "#059669",
                        backgroundColor: row.responded ? "#fff7ed" : "#ecfdf5",
                        color: row.responded ? "#c2410c" : "#047857",
                      }}
                    >
                      {row.responded ? "Mark unresponded" : "Mark responded"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
