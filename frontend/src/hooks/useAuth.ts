// frontend/src/hooks/useAuth.ts
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Me = { user: { email: string; name?: string } | null; isAdmin: boolean };

export function useAuth() {
  const [me, setMe] = useState<Me>({ user: null, isAdmin: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(api("/api/auth/me"), { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        setMe(d?.user ? d : { user: null, isAdmin: false });
      } catch {
        setMe({ user: null, isAdmin: false });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = () => { window.location.href = api("/api/auth/google"); };
  const signOut = async () => {
    try { await fetch(api("/api/auth/logout"), { method: "POST", credentials: "include" }); }
    finally { window.location.reload(); }
  };

  return { ...me, loading, signIn, signOut };
}
