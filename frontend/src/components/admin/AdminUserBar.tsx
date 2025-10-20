/* =========================================================================
   FILE: frontend/src/components/admin/AdminUserBar.tsx
   -------------------------------------------------------------------------
   Shows Google account + logout, resilient to slow /api/auth/me.
   ========================================================================= */
import React from "react";
import { useAuth } from "../../hooks/useAuth";

export default function AdminUserBar() {
  const { user, loading, signIn, logout } = useAuth();

  if (loading) return <div className="text-sm opacity-70">…</div>;
  if (!user) {
    return (
      <button
        onClick={signIn}
        className="text-sm px-3 py-1 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
      >
        Sign in with Google
      </button>
    );
  }

  const { email, name, picture } = user;
  return (
    <div className="flex items-center gap-3">
      {picture ? <img src={picture} alt="" className="w-8 h-8 rounded-full" /> : null}
      <div className="text-sm">
        <div className="font-semibold">{name || email}</div>
        <div className="opacity-70">{email}</div>
      </div>
      <button
        onClick={logout}
        className="text-sm px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
      >
        Logout
      </button>
    </div>
  );
}
