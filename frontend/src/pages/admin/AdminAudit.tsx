import React from "react";
import { api } from "../../lib/api";

const SORT_LABEL = {
  newest: "Newest",
  oldest: "Oldest",
};

export default function AdminAudit() {
  const [rows, setRows] = React.useState([]);
  const [actors, setActors] = React.useState([]);
  const [actions, setActions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const [search, setSearch] = React.useState("");
  const [selectedActor, setSelectedActor] = React.useState("all");
  const [selectedAction, setSelectedAction] = React.useState("all");
  const [limit, setLimit] = React.useState("100");
  const [sort, setSort] = React.useState("newest");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit);
      if (selectedActor !== "all") params.set("actor", selectedActor);
      if (selectedAction !== "all") params.set("action", selectedAction);
      if (search.trim()) params.set("q", search.trim());
      if (sort === "oldest") params.set("direction", "asc");

      const response = await fetch(api(`/api/admin/audit?${params.toString()}`), {
        credentials: "include",
      });

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      const payload = await response.json();
      setRows(payload.items || []);
      setActors(payload.actors || []);
      setActions(payload.actions || []);
    } catch (err) {
      setError(err?.message || "Failed to load audit log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [limit, selectedActor, selectedAction, search, sort]);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(handle);
  }, [load]);

  const clearFilters = () => {
    setSearch("");
    setSelectedActor("all");
    setSelectedAction("all");
    setLimit("100");
    setSort("newest");
  };

  return (
    <div className="text-gray-900">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Audit Log</h2>
          <p className="text-sm text-gray-500">Track every admin action, upload, and publish event.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            className="rounded border border-sky-600 bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 shadow-sm transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              search === "" && selectedActor === "all" && selectedAction === "all" && limit === "100" && sort === "newest"
            }
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded border bg-white p-4 text-sm md:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="actor, action, etc."
            className="rounded border px-3 py-2 text-black"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Actor</span>
          <select
            className="rounded border px-3 py-2 text-black"
            value={selectedActor}
            onChange={(e) => setSelectedActor(e.target.value)}
          >
            <option value="all">All actors</option>
            {actors.map((actor) => (
              <option key={actor} value={actor}>
                {actor}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-gray-500">Action</span>
          <select
            className="rounded border px-3 py-2 text-black"
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
          >
            <option value="all">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
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
                onChange={(e) => setSort(e.target.value)}
              >
              {Object.entries(SORT_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500">No audit activity yet.</div>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    {new Date(r.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{r.actor_email || "—"}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold uppercase tracking-wide">
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.meta ? (
                      <pre className="whitespace-pre-wrap break-words text-xs text-gray-600">
                        {typeof r.meta === "string" ? r.meta : JSON.stringify(r.meta, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
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
