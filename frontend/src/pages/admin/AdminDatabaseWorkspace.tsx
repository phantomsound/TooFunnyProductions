import React from "react";
import { api } from "../../lib/api";

type DatabaseStatus = {
  friendlyName: string;
  mode: "local" | "remote" | "unknown";
  host: string | null;
  url: string | null;
  supabaseConfigured: boolean;
  supabaseUrlPresent: boolean;
  serviceKeyPresent: boolean;
  serviceKeyRole: string | null;
  hasServiceRole: boolean;
  connectivity: { ok: boolean; message: string };
  warnings: string[];
};

const MODE_LABEL = {
  local: { label: "Local", className: "bg-emerald-500/20 text-emerald-200 border border-emerald-500/50" },
  remote: { label: "Remote", className: "bg-sky-500/20 text-sky-200 border border-sky-500/50" },
  unknown: { label: "Unknown", className: "bg-neutral-700 text-neutral-200 border border-neutral-600" },
};

export default function AdminDatabaseWorkspace(): JSX.Element {
  const [status, setStatus] = React.useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(api("/api/admin/database/status"), { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const payload = (await response.json()) as DatabaseStatus;
      setStatus(payload);
    } catch (err) {
      setError((err as Error)?.message || "Failed to load database status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const modeBadge = status ? MODE_LABEL[status.mode] : MODE_LABEL.unknown;
  const needsSupabaseConfig = status && (!status.supabaseUrlPresent || !status.serviceKeyPresent);

  return (
    <div className="space-y-6 text-neutral-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Admin data</p>
          <h1 className="text-3xl font-semibold text-yellow-300">Database workspace</h1>
          <p className="max-w-3xl text-sm text-neutral-300">
            A focused home for admin-owned database items, separate from the page configuration workflow. Keep an eye on which
            backend you are connected to before inviting the team to import content. The friendly name defaults to
            <span className="px-1 font-semibold text-yellow-200">MikoDB</span> so you can spot lingering Supabase connections
            quickly.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
      ) : null}

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm uppercase tracking-[0.16em] text-neutral-500">Connection</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${modeBadge.className}`}>
                {modeBadge.label}
              </span>
            </div>
            <h2 className="text-2xl font-semibold text-yellow-200">{status?.friendlyName ?? "Loading…"}</h2>
            <p className="text-sm text-neutral-300">
              {status?.connectivity?.message || "Detecting current backend…"}
            </p>
            {status?.warnings?.length ? (
              <ul className="space-y-1 text-sm text-amber-200">
                {status.warnings.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden className="mt-[2px] text-lg">⚠️</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid gap-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-sm sm:grid-cols-2">
            <StatusRow label="Friendly name" value={status?.friendlyName ?? "—"} />
            <StatusRow label="Mode" value={modeBadge.label} />
            <StatusRow label="Host" value={status?.host || "—"} />
            <StatusRow label="PostgREST URL" value={status?.url || "—"} />
            <StatusRow
              label="Credentials"
              value={status?.supabaseConfigured ? "Service key loaded" : "Missing secrets"}
              success={!!status?.supabaseConfigured}
            />
            <StatusRow
              label="Key role"
              value={status?.serviceKeyRole ? status.serviceKeyRole : status?.serviceKeyPresent ? "Unknown" : "—"}
              success={!!status?.hasServiceRole}
            />
            <StatusRow
              label="Reachable"
              value={status?.connectivity?.ok ? "Yes" : "Not yet"}
              success={!!status?.connectivity?.ok}
            />
          </div>
        </div>
      </section>

      {needsSupabaseConfig ? (
        <section className="rounded-xl border border-amber-800/70 bg-amber-950/40 p-5 text-sm text-amber-50 shadow-sm">
          <h3 className="text-lg font-semibold text-amber-100">PostgREST/Supabase setup needed</h3>
          <p className="mt-2 text-amber-100/90">
            The admin database workspace stays unconfigured until the backend can reach your local PostgREST gateway.
            Confirm the following in <span className="font-semibold">backend/.env</span> and restart the backend service:
          </p>
          <ul className="mt-3 space-y-2 list-disc pl-5">
            <li>
              <span className="font-semibold">SUPABASE_URL</span> → <code>http://127.0.0.1:54321</code> (PostgREST port, not the
              PostgreSQL 5432 port).
            </li>
            <li>
              <span className="font-semibold">SUPABASE_SERVICE_KEY</span> → your local service-role JWT from the PostgREST/Supabase
              stack.
            </li>
            <li>Restart the backend so the new env values load, then hit Refresh above.</li>
          </ul>
          <p className="mt-3 text-amber-100/80">
            Want to skip this for now? Leave both values blank and the backend will use its file-backed fallbacks until you’re
            ready to validate the migrated database.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
          <h3 className="text-xl font-semibold text-yellow-200">Admin item staging</h3>
          <p className="mt-2 text-sm text-neutral-300">
            Keep uploads for admin-owned collections here. This space is isolated from the page configuration screens so the team
            can bulk import catalogs, reference data, or other structured content without touching the public layout.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-neutral-200">
            <li>• Verify the connection badge reads <span className="font-semibold">MikoDB</span> when working locally.</li>
            <li>• Use the refresh button above after swapping environments to confirm the backend flipped correctly.</li>
            <li>• Coordinate uploads here so everything lands in the admin database before wiring it into the site.</li>
          </ul>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
          <h3 className="text-xl font-semibold text-yellow-200">Next steps for the team</h3>
          <p className="mt-2 text-sm text-neutral-300">
            Ready the database for incoming items and keep contributors aligned on where data should live.
          </p>
          <div className="mt-3 space-y-2 text-sm text-neutral-200">
            <ChecklistItem
              label="Confirm you are pointed at the correct backend (MikoDB locally or in your target environment)."
              done={!!status?.connectivity?.ok}
            />
            <ChecklistItem
              label="Share this workspace link with teammates so uploads happen outside the page configuration UI."
              done={false}
            />
            <ChecklistItem label="Add your import checklist or SOPs to this space as the pipeline firms up." done={false} />
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusRow({
  label,
  value,
  success,
}: {
  label: string;
  value: string;
  success?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <div className={`font-semibold ${success ? "text-emerald-200" : "text-neutral-100"}`}>{value}</div>
    </div>
  );
}

function ChecklistItem({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-[3px] inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold ${
          done
            ? "border-emerald-400 bg-emerald-500/10 text-emerald-200"
            : "border-neutral-600 bg-neutral-800 text-neutral-300"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <span>{label}</span>
    </div>
  );
}
