// frontend/src/hooks/useAuth.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export type AuthUser = { email: string; name?: string | null; picture?: string | null };

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const apply = useCallback((nextUser: AuthUser | null, nextAdmin: boolean) => {
    if (!mounted.current) return;
    setUser(nextUser);
    setIsAdmin(nextAdmin);
  }, []);

  const fetchMe = useCallback(async () => {
    if (mounted.current) setLoading(true);
    try {
      const r = await fetch(api("/api/auth/me"), { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (d?.user) {
        apply(
          {
            email: d.user.email,
            name: d.user.name ?? null,
            picture: d.user.picture ?? null,
          },
          !!d.isAdmin
        );
      } else {
        apply(null, false);
      }
    } catch {
      apply(null, false);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    fetchMe();
    return () => {
      mounted.current = false;
    };
  }, [fetchMe]);

  const signIn = useCallback(() => {
    window.location.href = api("/api/auth/google");
  }, []);

  const refreshSession = useCallback(async () => {
    await fetch(api("/api/auth/me"), { credentials: "include" });
    await fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await fetch(api("/api/auth/logout"), { method: "POST", credentials: "include" });
    } finally {
      apply(null, false);
      const next = window.location.pathname.startsWith("/admin") ? "/admin" : "/";
      window.location.href = next;
    }
  }, [apply]);

  return {
    user,
    isAdmin,
    isAuthed: !!user,
    loading,
    signIn,
    signOut: logout,
    logout,
    refreshSession,
    reload: fetchMe,
  };
}
