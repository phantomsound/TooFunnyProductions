// frontend/src/components/Navbar.tsx
// ──────────────────────────────────────────────────────────────

import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Navbar() {
  const { search, pathname } = useLocation();
  const { signIn, user, isAdmin } = useAuth();
  const sp = new URLSearchParams(search);
  const stageSuffix = sp.get("stage") === "draft" ? "?stage=draft" : "";

  const Item: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
    <Link
      to={`${to}${stageSuffix}`}
      className="px-3 py-2 text-sm opacity-90 hover:opacity-100"
    >
      {children}
    </Link>
  );

  return (
    <nav className="w-full bg-neutral-900/95 backdrop-blur border-b border-white/10">
      <div className="mx-auto max-w-6xl h-12 flex items-center justify-between px-4">
        <Link to={`/${stageSuffix}`} className="text-yellow-400 font-semibold">
          Too Funny Productions
        </Link>

        <div className="flex items-center gap-1">
          <Item to="/">Home</Item>
          <Item to="/about">About</Item>
          <Item to="/events">Events</Item>
          <Item to="/media">Media</Item>
          <Item to="/merch">Merch</Item>
          <Item to="/contact">Contact</Item>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Link
              to="/admin"
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold hover:border-yellow-400"
            >
              Admin
            </Link>
          ) : user ? null : pathname.startsWith("/admin") ? null : (
            <button
              onClick={signIn}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold hover:border-yellow-400"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
