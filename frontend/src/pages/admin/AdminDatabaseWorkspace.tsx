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

type DatabaseConfig = {
  friendlyName: string;
  supabaseUrl: string;
  serviceKey: string;
  pgadminUrl: string;
};

type SqlScript = {
  id: string;
  filename: string;
  folder: string;
  label: string;
  helper: string;
  dateWritten?: string;
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
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [notesLoaded, setNotesLoaded] = React.useState(false);
  const [config, setConfig] = React.useState<DatabaseConfig | null>(null);
  const [savingConfig, setSavingConfig] = React.useState(false);
  const [scripts, setScripts] = React.useState<SqlScript[]>([]);
  const [scriptsError, setScriptsError] = React.useState<string | null>(null);
  const [scriptsLoading, setScriptsLoading] = React.useState(false);

  const formatDate = React.useCallback((value?: string) => {
    if (!value) return "Date unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Date unknown";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
  }, []);

  const loadConfig = React.useCallback(async () => {
    setConfigError(null);
    try {
      const response = await fetch(api("/api/admin/database/config"), { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const payload = (await response.json()) as { config: DatabaseConfig };
      setConfig(payload.config);
    } catch (err) {
      setConfigError((err as Error)?.message || "Failed to load database config");
      setConfig(null);
    }
  }, []);

  const loadScripts = React.useCallback(async () => {
    setScriptsError(null);
    setScriptsLoading(true);
    try {
      const response = await fetch(api("/api/admin/database/sql-scripts"), { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const payload = (await response.json()) as { scripts: SqlScript[] };
      setScripts(payload.scripts || []);
    } catch (err) {
      setScriptsError((err as Error)?.message || "Failed to load SQL scripts");
      setScripts([]);
    } finally {
      setScriptsLoading(false);
    }
  }, []);

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
    loadConfig();
    loadScripts();
  }, [load, loadConfig, loadScripts]);

  const modeBadge = status ? MODE_LABEL[status.mode] : MODE_LABEL.unknown;
  const needsSupabaseConfig = status && (!status.supabaseUrlPresent || !status.serviceKeyPresent);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("admin-database-workspace-notes");
      if (stored) setNotes(stored);
    } catch (err) {
      console.warn("Failed to read workspace notes", err);
    } finally {
      setNotesLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    if (!notesLoaded || notes) return;
    if (!status) return;

    const scaffold = [
      `Connection name: ${status.friendlyName ?? "Unknown"}`,
      `Mode: ${modeBadge.label}`,
      `Host: ${status.host || "—"}`,
      `PostgREST: ${status.url || "—"}`,
      status.supabaseConfigured ? "Supabase credentials detected" : "Supabase credentials missing",
    ]
      .filter(Boolean)
      .join("\n");

    setNotes(scaffold);
  }, [status, notesLoaded, notes, modeBadge.label]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    try {
      localStorage.setItem("admin-database-workspace-notes", value);
    } catch (err) {
      console.warn("Failed to persist workspace notes", err);
    }
  };

  const handleConfigChange = (key: keyof DatabaseConfig, value: string) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    setConfigError(null);
    try {
      const response = await fetch(api("/api/admin/database/config"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      await response.json();
      await load();
    } catch (err) {
      setConfigError((err as Error)?.message || "Failed to save database config");
    } finally {
      setSavingConfig(false);
    }
  };

  const pgadminTarget = (config?.pgadminUrl || "http://127.0.0.1:5050/browser/").trim();

  const launchPgAdmin = () => {
    if (!pgadminTarget) return;
    window.open(pgadminTarget, "_blank", "noreferrer");
  };

  return (
    <div className="space-y-6 text-neutral-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Admin data</p>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold text-yellow-300">Database workspace</h1>
            <p className="max-w-3xl text-sm text-neutral-300">
              A focused home for admin-owned database items, separate from the page configuration workflow. Keep an eye on
              which backend you are connected to before inviting the team to import content. The friendly name defaults to
              <span className="px-1 font-semibold text-yellow-200">MikoDB</span> so you can spot lingering Supabase
              connections quickly.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300 shadow-sm">
            <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">Connection</div>
            <div className="mt-1 flex items-center gap-2 text-base font-semibold text-yellow-200">
              {status?.friendlyName ?? "Unconfigured"}
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${modeBadge.className}`}>
                {modeBadge.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-400">{status?.connectivity?.message || "Detecting current backend…"}</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-sm font-semibold text-neutral-100 shadow-sm transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
      ) : null}
      {configError ? (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-100">{configError}</div>
      ) : null}

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm uppercase tracking-[0.16em] text-neutral-500">
              <span>Connection</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${modeBadge.className}`}>{modeBadge.label}</span>
            </div>
            <h2 className="text-2xl font-semibold text-yellow-200">{status?.friendlyName ?? "Loading…"}</h2>
            <p className="text-sm text-neutral-300">
              {status?.connectivity?.message || "Detecting current backend…"}
            </p>
            {status?.warnings?.length ? (
              <ul className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">
                {status.warnings.map((item) => (
                  <li key={item} className="flex items-start gap-2 leading-snug">
                    <span aria-hidden className="mt-[2px] text-lg">⚠️</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid gap-3 rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm sm:grid-cols-2">
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

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-yellow-200">Edit database configuration</h3>
            <p className="mt-1 text-sm text-neutral-300">
              Update the friendly name, PostgREST URL, and service role key directly from this workspace, then refresh to
              verify connectivity.
            </p>
          </div>
          <div className="text-xs text-neutral-500">Refresh still available above for quick re-checks.</div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500" htmlFor="db-friendly-name">
              Friendly name
            </label>
            <input
              id="db-friendly-name"
              type="text"
              value={config?.friendlyName ?? ""}
              onChange={(e) => handleConfigChange("friendlyName", e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 shadow-inner focus:border-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              placeholder="MikoDB"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500" htmlFor="db-supabase-url">
              PostgREST URL (SUPABASE_URL)
            </label>
            <input
              id="db-supabase-url"
              type="text"
              value={config?.supabaseUrl ?? ""}
              onChange={(e) => handleConfigChange("supabaseUrl", e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 shadow-inner focus:border-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              placeholder="http://127.0.0.1:54321"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500" htmlFor="pgadmin-url">
              pgAdmin 4 URL (optional)
            </label>
            <input
              id="pgadmin-url"
              type="text"
              value={config?.pgadminUrl ?? ""}
              onChange={(e) => handleConfigChange("pgadminUrl", e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 shadow-inner focus:border-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              placeholder="http://127.0.0.1:5050/browser/"
              spellCheck={false}
            />
            <p className="text-xs text-neutral-500">Used to open pgAdmin from the workspace.</p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500" htmlFor="db-service-key">
              Service role key (SUPABASE_SERVICE_KEY)
            </label>
            <textarea
              id="db-service-key"
              value={config?.serviceKey ?? ""}
              onChange={(e) => handleConfigChange("serviceKey", e.target.value)}
              className="h-24 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 shadow-inner focus:border-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              placeholder="Paste the service_role JWT from your PostgREST stack"
            />
            <div className="flex items-center justify-end gap-3 text-xs text-neutral-500">
              <span>Values save to backend/data so the workspace can reload them later.</span>
              <button
                type="button"
                onClick={saveConfig}
                disabled={savingConfig || !config}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-sm font-semibold text-neutral-100 shadow-sm transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingConfig ? "Saving…" : "Save config"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {needsSupabaseConfig ? (
        <section className="rounded-xl border border-amber-800/70 bg-amber-950/40 p-5 text-sm text-amber-50 shadow-sm">
          <h3 className="text-lg font-semibold text-amber-100">PostgREST/Supabase setup needed</h3>
          <p className="mt-2 text-amber-100/90">
            The admin database workspace stays unconfigured until the backend can reach your local PostgREST gateway.
            Confirm the following values and save them above so the backend can retry connectivity:
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
              <li>Save the values above and hit Refresh to verify connectivity.</li>
            </ul>
          <p className="mt-3 text-amber-100/80">
            Want to skip this for now? Leave both values blank and the backend will use its file-backed fallbacks until you’re
            ready to validate the migrated database.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-5 shadow-sm backdrop-blur">
          <h3 className="text-xl font-semibold text-yellow-200">Connection snapshot</h3>
          <p className="mt-2 text-sm text-neutral-300">Key values pulled from the backend to validate the current database.</p>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm text-neutral-200 sm:grid-cols-2">
            <SnapshotRow label="Friendly name" value={status?.friendlyName ?? "—"} />
            <SnapshotRow label="Mode" value={modeBadge.label} />
            <SnapshotRow label="Host" value={status?.host || "—"} />
            <SnapshotRow label="PostgREST" value={status?.url || "—"} />
            <SnapshotRow
              label="Supabase configured"
              value={status?.supabaseConfigured ? "Yes" : "No"}
              success={!!status?.supabaseConfigured}
            />
            <SnapshotRow
              label="Service role"
              value={status?.hasServiceRole ? "Service role detected" : "Missing service role"}
              success={!!status?.hasServiceRole}
            />
          </dl>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-yellow-200">SQL scripts</h3>
              <p className="text-sm text-neutral-300">
                Pull vetted SQL helpers directly from the repo. Download them or open pgAdmin 4 to run the scripts. Each entry
                includes a short note and the date it was last updated.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={launchPgAdmin}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm font-semibold text-neutral-100 shadow-sm transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900"
              >
                Open pgAdmin 4
              </button>
              <button
                type="button"
                onClick={loadScripts}
                disabled={scriptsLoading}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm font-semibold text-neutral-100 shadow-sm transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {scriptsLoading ? "Refreshing…" : "Refresh scripts"}
              </button>
            </div>
          </div>

          {scriptsError ? (
            <div className="mt-3 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-100">{scriptsError}</div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {scriptsLoading && !scripts.length ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-300">Loading scripts…</div>
            ) : null}

            {!scriptsLoading && scripts.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-300">
                No SQL scripts detected in backend/docs yet.
              </div>
            ) : null}

            {scripts.map((script) => (
              <div
                key={script.id}
                className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-100 shadow-inner shadow-black/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">{script.label}</div>
                    <div className="text-base font-semibold text-yellow-200 break-words">{script.filename}</div>
                  </div>
                  <span className="whitespace-nowrap rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                    {formatDate(script.dateWritten)}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-neutral-300">{script.helper}</p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={api(`/api/admin/database/sql-scripts/${encodeURIComponent(script.id)}`)}
                    className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 shadow-sm transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900"
                    download
                  >
                    Download SQL
                  </a>
                  <button
                    type="button"
                    onClick={launchPgAdmin}
                    className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 shadow-sm transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900"
                  >
                    Open in pgAdmin 4
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur">
          <h3 className="text-xl font-semibold text-yellow-200">Workspace notes</h3>
          <p className="mt-2 text-sm text-neutral-300">
            Keep admin-only notes here without touching the page configuration system. Edits stay local to your browser.
          </p>
          <div className="mt-3">
            <label className="sr-only" htmlFor="workspace-notes">
              Workspace notes
            </label>
            <textarea
              id="workspace-notes"
              className="h-40 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 shadow-inner focus:border-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-300"
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Document database setup steps, owners, or SOPs without publishing them to the site."
            />
            <p className="mt-1 text-xs text-neutral-500">Saved locally in this browser so you can jot down setup details.</p>
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

function SnapshotRow({
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
