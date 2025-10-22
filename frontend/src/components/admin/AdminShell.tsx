/* =========================================================================
   FILE: frontend/src/components/admin/AdminShell.tsx
   -------------------------------------------------------------------------
   Fixed layout admin shell with sidebar and top-right user bar.
   ========================================================================= */
import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useSettings } from "../../lib/SettingsContext";
import AdminUserBar from "./AdminUserBar";

const normalizeQuickLinks = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { label: string; url: string } => {
      if (!item || typeof item !== "object") return false;
      const maybe = item as { label?: unknown; url?: unknown };
      return typeof maybe.label === "string" && typeof maybe.url === "string";
    })
    .slice(0, 4)
    .map((item) => ({ label: item.label.trim() || item.url.trim(), url: item.url.trim() }));
};

const formatQuickLinkHref = (input: string) => {
  if (!input) return "#";
  const trimmed = input.trim();
  if (trimmed.startsWith("/")) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed; // protocol already present (http, mailto, etc.)
  return `https://${trimmed.replace(/^https?:\/\//i, "")}`;
};

export default function AdminShell() {
  const { settings } = useSettings();
  const quickLinks = React.useMemo(() => normalizeQuickLinks(settings?.admin_quick_links), [settings?.admin_quick_links]);

  return (
    <div className="min-h-[80vh] grid grid-cols-[260px_1fr] gap-0 bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <aside className="border-r border-neutral-800 bg-neutral-900">
        <div className="p-5 text-xl font-bold text-yellow-400">Admin</div>
        <nav className="px-3 py-2 space-y-1">
          <NavLink
            to="/admin/settings"
            className={({ isActive }) =>
              "block rounded px-3 py-2 hover:bg-neutral-800 " +
              (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
            }
          >
            ⚙️ Settings
          </NavLink>
          <NavLink
            to="/admin/media"
            className={({ isActive }) =>
              "block rounded px-3 py-2 hover:bg-neutral-800 " +
              (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
            }
          >
            🎬 Media Manager
          </NavLink>
          <NavLink
            to="/admin/audit"
            className={({ isActive }) =>
              "block rounded px-3 py-2 hover:bg-neutral-800 " +
              (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
            }
          >
            🧾 Audit Log
          </NavLink>
        </nav>
        {quickLinks.length > 0 ? (
          <div className="mt-6 border-t border-neutral-800 pt-4">
            <div className="px-5 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Quick Links</div>
            <ul className="mt-3 space-y-1 px-3 text-sm">
              {quickLinks.map((link) => (
                <li key={`${link.label}-${link.url}`}>
                  <a
                    href={formatQuickLinkHref(link.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded px-3 py-2 text-neutral-300 hover:bg-neutral-800 hover:text-yellow-200"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      {/* Main */}
      <main className="min-h-[80vh]">
        <div className="flex items-center justify-end border-b border-neutral-800 bg-neutral-900 px-4 py-2">
          <AdminUserBar />
        </div>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
