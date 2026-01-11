// frontend/src/components/Navbar.tsx
// ──────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import useAuth from "../hooks/useAuth";
import { useSettings } from "../lib/SettingsContext";
import { resolveMediaUrl } from "../utils/media";
import { resolveLiveStreamInfo } from "../utils/liveStream";

export default function Navbar() {
  const { search, pathname } = useLocation();
  const sp = new URLSearchParams(search);
  const stageSuffix = sp.get("stage") === "draft" ? "?stage=draft" : "";
  const { settings } = useSettings();
  const { user } = useAuth();
  const liveStream = resolveLiveStreamInfo(settings);

  const logoUrlRaw =
    typeof settings?.logo_url === "string" && settings.logo_url.trim().length > 0
      ? settings.logo_url.trim()
      : "";
  const logoUrl = logoUrlRaw ? resolveMediaUrl(logoUrlRaw) : "";
  const siteTitle =
    typeof settings?.site_title === "string" && settings.site_title.trim().length > 0
      ? settings.site_title.trim()
      : "Too Funny Productions";
  const homeHref = stageSuffix ? `/${stageSuffix}` : "/";

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
      <div className="mx-auto flex h-12 w-full max-w-screen-xl items-center justify-between px-4 text-theme-header sm:px-6 md:px-8 lg:px-10 xl:px-12">
        <Link to={homeHref} className="flex items-center gap-3 overflow-hidden">
          {logoUrl ? (
            <>
              <img
                src={logoUrl}
                alt={siteTitle}
                className="h-9 w-auto max-w-[150px] object-contain"
              />
              <span className="whitespace-nowrap text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-theme-header sm:text-[0.7rem] md:text-[0.75rem]">
                {siteTitle}
              </span>
            </>
          ) : (
            <span className="text-lg font-semibold text-theme-header">{siteTitle}</span>
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
          {liveStream.show && liveStream.href ? (
            <a
              href={liveStream.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] transition sm:inline-flex ${
                liveStream.state === "starting"
                  ? "border-yellow-300/60 text-yellow-200"
                  : "border-red-500/70 text-red-200"
              }`}
            >
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${liveStream.state === "starting" ? "bg-yellow-400" : "bg-red-500"} tf-live-pulse`} />
              <span>{liveStream.label}</span>
            </a>
          ) : null}
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
          <div className="mx-auto flex w-full max-w-screen-xl flex-col px-4 py-2">
            {liveStream.show && liveStream.href ? (
              <a
                href={liveStream.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`mb-2 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] ${
                  liveStream.state === "starting"
                    ? "border-yellow-300/60 text-yellow-200"
                    : "border-red-500/70 text-red-200"
                }`}
              >
                <span className={`inline-flex h-2 w-2 rounded-full ${liveStream.state === "starting" ? "bg-yellow-400" : "bg-red-500"} tf-live-pulse`} />
                <span>{liveStream.label}</span>
              </a>
            ) : null}
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
