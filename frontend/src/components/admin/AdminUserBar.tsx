/* =========================================================================
   FILE: frontend/src/components/admin/AdminUserBar.tsx
   -------------------------------------------------------------------------
   Shows Google account + logout, resilient to slow /api/auth/me.
   ========================================================================= */
import React from "react";
import { useAuth } from "../../hooks/useAuth";

export default function AdminUserBar() {
  const { user, loading, signIn, logout } = useAuth();
  const [showAvatar, setShowAvatar] = React.useState(true);

  React.useEffect(() => {
    // Reset the avatar visibility whenever the signed-in user changes.
    setShowAvatar(true);
  }, [user?.email, user?.picture]);

  if (loading) return <div className="text-sm opacity-70">…</div>;
  if (!user) {
    return (
      <button
        onClick={signIn}
        className="rounded-md border border-yellow-200/70 bg-yellow-400 px-3 py-1.5 text-sm font-semibold text-black transition hover:-translate-y-[1px] hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-offset-2 focus:ring-offset-neutral-900"
      >
        Sign in with Google
      </button>
    );
  }

  const { email, name, picture } = user;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-800/70 bg-neutral-900/60 px-3 py-2 shadow-sm">
      {picture && showAvatar ? (
        <img
          src={picture}
          alt=""
          className="h-9 w-9 rounded-full border border-neutral-800 object-cover"
          onError={() => setShowAvatar(false)}
        />
      ) : null}
      <div className="text-sm">
        <div className="font-semibold text-yellow-100">{name || email}</div>
        <div className="text-xs text-neutral-400">{email}</div>
      </div>
      <button
        onClick={logout}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:-translate-y-[1px] hover:border-yellow-300 hover:text-yellow-200"
      >
        Logout
      </button>
    </div>
  );
}
