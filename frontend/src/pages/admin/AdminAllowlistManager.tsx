import React, { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api";

interface AllowlistResponse {
  combined?: string[];
  editable?: string[];
  env?: string[];
  error?: string;
}

const normalizeEmail = (value: string): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes("@")) return null;
  return trimmed;
};

export default function AdminAllowlistManager(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [editable, setEditable] = useState<string[]>([]);
  const [envEmails, setEnvEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  const allowedCount = useMemo(() => {
    const set = new Set<string>();
    editable.forEach((email) => set.add(email));
    envEmails.forEach((email) => set.add(email));
    return set.size;
  }, [editable, envEmails]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFormError(null);
    setFormSuccess(null);
    try {
      const response = await fetch(api("/api/admin/allowlist"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const payload: AllowlistResponse = await response.json();
      setEditable(Array.isArray(payload.editable) ? payload.editable : []);
      setEnvEmails(Array.isArray(payload.env) ? payload.env : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load allowlist");
      setEditable([]);
      setEnvEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    setFormError(null);
    setFormSuccess(null);
    const normalized = normalizeEmail(newEmail);
    if (!normalized) {
      setFormError("Enter a valid email address (example@domain.com).");
      return;
    }
    if (editable.includes(normalized) || envEmails.includes(normalized)) {
      setFormError("That email address is already allowed.");
      return;
    }
    setEditable((prev) => [...prev, normalized]);
    setNewEmail("");
  };

  const handleRemove = (email: string) => {
    setFormError(null);
    setFormSuccess(null);
    setEditable((prev) => prev.filter((value) => value !== email));
  };

  const handleSave = async () => {
    setFormError(null);
    setFormSuccess(null);
    setSaving(true);
    try {
      const response = await fetch(api("/api/admin/allowlist"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: editable }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as AllowlistResponse;
        throw new Error(payload.error || `Request failed: ${response.status}`);
      }
      const payload: AllowlistResponse = await response.json();
      setEditable(Array.isArray(payload.editable) ? payload.editable : []);
      setEnvEmails(Array.isArray(payload.env) ? payload.env : []);
      setFormSuccess("Allowlist updated successfully.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  };

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-6 shadow-lg backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-yellow-200">Admin Access</h2>
          <p className="text-sm text-neutral-300">
            Control which Google accounts can open the admin dashboard. Updates apply immediately after saving.
          </p>
        </div>
        <div className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200">
          <span className="text-xs uppercase tracking-[0.2em] text-neutral-500">Allowed</span>
          <div className="text-lg font-semibold text-yellow-200">{allowedCount}</div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button
              onClick={load}
              className="rounded border border-red-400/60 px-3 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
              disabled={loading}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <div className="mt-4 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>
      ) : null}

      {formSuccess ? (
        <div className="mt-4 rounded border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-200">{formSuccess}</div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-neutral-100">Editable allowlist</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Add teammates below. Removing an address will block their next login unless they are still listed in the
              environment configuration.
            </p>
          </div>

          <div className="space-y-2">
            {editable.length === 0 ? (
              <p className="rounded border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-400">
                No extra admin emails yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {editable.map((email) => (
                  <li
                    key={email}
                    className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100"
                  >
                    <span>{email}</span>
                    <button
                      onClick={() => handleRemove(email)}
                      className="rounded border border-red-500/60 px-2 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
                      disabled={saving || loading}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="name@example.com"
              className="w-full rounded border border-neutral-700 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none"
              disabled={saving || loading}
            />
            <button
              onClick={handleAdd}
              className="rounded border border-yellow-400/60 bg-yellow-400/10 px-3 py-2 text-sm font-semibold text-yellow-200 transition hover:bg-yellow-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving || loading}
            >
              Add email
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded border border-neutral-800 bg-neutral-900/60 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-400">Environment allowlist</h3>
          <p className="text-xs text-neutral-400">
            These emails come from the <code className="rounded bg-neutral-800 px-1 py-0.5 text-[10px]">ALLOWLIST_EMAILS</code> environment
            variable and cannot be edited here.
          </p>
          {envEmails.length === 0 ? (
            <p className="rounded border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-500">
              No environment-based admins configured.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-neutral-200">
              {envEmails.map((email) => (
                <li key={email} className="rounded border border-neutral-800 bg-neutral-900/70 px-3 py-1">
                  {email}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          onClick={load}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || saving}
        >
          Reset
        </button>
        <button
          onClick={handleSave}
          className="rounded bg-yellow-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {loading && (
        <p className="mt-4 text-xs text-neutral-500">Loading allowlist…</p>
      )}
    </section>
  );
}
