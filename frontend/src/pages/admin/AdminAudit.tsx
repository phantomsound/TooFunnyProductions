import React from "react";
import { api } from "../../lib/api";

type Row = {
  id: string;
  occurred_at: string;
  actor_email: string;
  action: string;
  meta?: any;
};

export default function AdminAudit() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await fetch(api("/api/admin/audit?limit=100"), { credentials: "include" });
      if (!r.ok) {
        setLoading(false);
        return;
      }
      const d = await r.json();
      setRows(d || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="text-gray-900">
      <h2 className="mb-4 text-2xl font-bold">Audit Log</h2>
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
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{r.actor_email}</td>
                  <td className="px-3 py-2">{r.action}</td>
                  <td className="px-3 py-2">
                    <pre className="whitespace-pre-wrap text-xs text-gray-600">
                      {r.meta ? JSON.stringify(r.meta, null, 2) : "-"}
                    </pre>
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
