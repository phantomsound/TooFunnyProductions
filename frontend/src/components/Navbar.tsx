// frontend/src/components/Navbar.tsx
// ──────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import useAuth from "../hooks/useAuth";
import { useSettings } from "../lib/SettingsContext";
import { resolveMediaUrl } from "../utils/media";

export default function Navbar() {
  const { search, pathname } = useLocation();
  const sp = new URLSearchParams(search);
  const stageSuffix = sp.get("stage") === "draft" ? "?stage=draft" : "";
  const { settings } = useSettings();
  const { user } = useAuth();

  const logoUrlRaw =
    typeof settings?.logo_url === "string" && settings.logo_url.trim().length > 0
      ? settings.logo_url.trim()
      : "";
  const logoUrl = logoUrlRaw ? resolveMediaUrl(logoUrlRaw) : "";

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname, stageSuffix]);

  const navLinks = [
    { label: "Home", to: "/" },
    { label: "Media", to: "/media" },
    { label: "Merch", to: "/merch" },
    { label: "Events", to: "/events" },
    { label: "About", to: "/about" },
    { label: "Contact", to: "/contact" },
  ];

  const Item: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
    <Link to={`${to}${stageSuffix}`} className="nav-link-theme px-3 py-2 text-sm">
      {children}
    </Link>
  );

  return (
    <nav className="w-full border-b border-theme-surface bg-theme-header backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 text-theme-header">
        <Link to={`/${stageSuffix}`} className="flex items-center gap-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Too Funny Productions"
              className="h-9 w-auto max-w-[150px] object-contain"
            />
          ) : (
            <span className="font-semibold text-theme-accent">Too Funny Productions</span>
          )}
        </Link>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-theme-header focus:outline-none focus:ring-2 focus:ring-theme-accent md:hidden"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          aria-expanded={isMobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25"}
            />
          </svg>
        </button>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Item key={link.label} to={link.to}>
              {link.label}
            </Item>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-theme-surface bg-theme-surface/60 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-theme-accent">
              Admin Mode
            </span>
          ) : null}

          <div className="flex h-8 w-8 items-center justify-center">
            {user?.picture && !pathname.startsWith("/admin") ? (
              <Link
                to={`/admin${stageSuffix}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20"
              >
                <img
                  src={user.picture}
                  alt="Navigate to admin dashboard"
                  className="h-8 w-8 rounded-full object-cover"
                  onError={(event) => {
                    const target = event.currentTarget;
                    target.remove();
                  }}
                />
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {isMobileMenuOpen ? (
        <div className="border-t border-theme-surface bg-theme-header text-theme-header md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col px-4 py-2">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={`${link.to}${stageSuffix}`}
                className="nav-link-theme w-full rounded-md px-3 py-2 text-sm"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
