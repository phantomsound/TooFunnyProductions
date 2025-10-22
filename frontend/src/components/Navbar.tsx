// frontend/src/components/Navbar.tsx
// ──────────────────────────────────────────────────────────────

import React from "react";
import { Link, useLocation } from "react-router-dom";

import useAuth from "../hooks/useAuth";
import { useSettings } from "../lib/SettingsContext";

export default function Navbar() {
  const { search, pathname } = useLocation();
  const sp = new URLSearchParams(search);
  const stageSuffix = sp.get("stage") === "draft" ? "?stage=draft" : "";
  const { settings } = useSettings();
  const { user } = useAuth();

  const logoUrl =
    typeof settings?.logo_url === "string" && settings.logo_url.trim().length > 0
      ? settings.logo_url
      : null;

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

        <div className="flex items-center gap-1">
          <Item to="/">Home</Item>
          <Item to="/about">About</Item>
          <Item to="/events">Events</Item>
          <Item to="/media">Media</Item>
          <Item to="/merch">Merch</Item>
          <Item to="/contact">Contact</Item>
        </div>

        <div className="h-8 w-8 flex items-center justify-center">
          {user?.picture && !pathname.startsWith("/admin") ? (
            <img
              src={user.picture}
              alt=""
              className="h-8 w-8 rounded-full border border-white/20 object-cover"
              onError={(event) => {
                const target = event.currentTarget;
                target.remove();
              }}
            />
          ) : null}
        </div>
      </div>
    </nav>
  );
}
