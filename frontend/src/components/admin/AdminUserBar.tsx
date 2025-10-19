/* =========================================================================
   FILE: frontend/src/components/admin/AdminUserBar.tsx
   -------------------------------------------------------------------------
   Shows Google account + logout, resilient to slow /api/auth/me.
   ========================================================================= */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Me = { user: { email: string; name?: string; picture?: string } | null; isAdmin: boolean };

export default function AdminUserBar() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(api("/api/auth/me"), { credentials: "include" });
        const d = (await r.json()) as Me;
        if (!cancel) setMe(d);
      } catch {
        if (!cancel) setMe({ user: null, isAdmin: false });
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  if (!me) return <div className="text-sm opacity-70">…</div>;
  if (!me.user) {
    return (
      <a
        href={api("/api/auth/google")}
        className="text-sm px-3 py-1 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
      >
        Sign in with Google
      </a>
    );
  }

  const { email, name, picture } = me.user;
  return (
    <div className="flex items-center gap-3">
      {picture ? <img src={picture} alt="" className="w-8 h-8 rounded-full" /> : null}
      <div className="text-sm">
        <div className="font-semibold">{name || email}</div>
        <div className="opacity-70">{email}</div>
      </div>
      <form
        action={api("/api/auth/logout")}
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          fetch(api("/api/auth/logout"), { method: "POST", credentials: "include" }).then(() => {
            location.href = "/admin";
          });
        }}
      >
        <button className="text-sm px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">
          Logout
        </button>
      </form>
    </div>
  );
}
