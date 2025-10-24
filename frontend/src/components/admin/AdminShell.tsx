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

const navLinks = [
  { to: "/admin/general", label: "🎛 General Settings" },
  { to: "/admin/page-configurations", label: "🗂 Page Configurations" },
  { to: "/admin/media", label: "🎬 Media Manager" },
  { to: "/admin/audit", label: "🧾 Audit Log" },
];

export default function AdminShell() {
  const { settings } = useSettings();
  const quickLinks = React.useMemo(() => normalizeQuickLinks(settings?.admin_quick_links), [settings?.admin_quick_links]);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const renderNavLink = (link: (typeof navLinks)[number]) => (
    <NavLink
      key={link.to}
      to={link.to}
      onClick={() => setMobileMenuOpen(false)}
      className={({ isActive }) =>
        "block rounded px-3 py-2 text-sm transition hover:bg-neutral-800 " +
        (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
      }
    >
      {link.label}
    </NavLink>
  );

  const renderQuickLinks = (listClassName = "px-4") =>
    quickLinks.length > 0 ? (
      <div className="mt-4 border-t border-neutral-800 pt-4">
        <div className="px-4 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Quick Links</div>
        <ul className={`mt-3 space-y-1 text-sm ${listClassName}`}>
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
    ) : null;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="flex flex-col lg:grid lg:grid-cols-[260px_1fr]">
        {/* Sidebar for large screens */}
        <aside className="hidden min-h-screen border-r border-neutral-800 bg-neutral-900 lg:flex lg:flex-col">
          <div className="p-5 text-xl font-bold text-yellow-400">Admin</div>
          <nav className="px-3 py-2 space-y-1">{navLinks.map(renderNavLink)}</nav>
          {renderQuickLinks()}
        </aside>

        {/* Main */}
        <main className="min-h-screen">
          <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-3 lg:justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded border border-neutral-700 px-3 py-1 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900 lg:hidden"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-controls="admin-mobile-nav"
            >
              <span>{mobileMenuOpen ? "Close" : "Menu"}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-4 w-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={mobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"}
                />
              </svg>
            </button>

            <div className="ml-auto">
              <AdminUserBar />
            </div>
          </div>

          {mobileMenuOpen ? (
            <div
              id="admin-mobile-nav"
              className="border-b border-neutral-800 bg-neutral-900 px-4 py-3 lg:hidden"
            >
              <nav className="space-y-1">{navLinks.map(renderNavLink)}</nav>
              {renderQuickLinks("px-0")}
            </div>
          ) : null}

          <div className="p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
