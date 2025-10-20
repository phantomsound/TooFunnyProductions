// frontend/src/components/WhoAmI.tsx
import React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function WhoAmI() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  if (pathname.startsWith("/admin")) return null;
  if (!user) return null;

  return (
    <button
      onClick={logout}
      className="flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-xs hover:border-yellow-400"
    >
      {user.picture ? <img src={user.picture} alt="" className="h-6 w-6 rounded-full" /> : null}
      <span className="opacity-80">{user.name || user.email}</span>
    </button>
  );
}
