// frontend/src/components/admin/AuthGuard.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Protects /admin routes. Uses your existing useAuth() contract exactly.
// If unauthenticated, shows an in-place login gate (no redirect to "/").
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { useAuth } from "../../hooks/useAuth";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading, signIn } = useAuth();

  // While we’re checking the session, show a minimal loader (prevents flicker).
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-900 text-white">
        <div className="text-center">
          <div className="text-xl font-semibold mb-2">Checking admin access…</div>
          <div className="opacity-70 text-sm">Please wait</div>
        </div>
      </div>
    );
  }

  // Not logged in or not an admin → show sign-in gate right here.
  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-900 text-white">
        <div className="bg-neutral-800/60 border border-neutral-700 rounded-lg p-8 w-[min(90vw,420px)] text-center">
          <div className="text-2xl font-bold mb-2">Admin sign-in required</div>
          <p className="opacity-80 mb-6">
            You need to sign in with your admin Google account to access the admin panel.
          </p>
          <button
            onClick={signIn}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
          >
            {/* simple G icon glyph */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36 16.8 36 11 30.2 11 23S16.8 10 24 10c3.4 0 6.5 1.3 8.8 3.4l5.7-5.7C34.7 4 29.6 2 24 2 12.3 2 2.9 11.4 2.9 23S12.3 44 24 44c11.3 0 21-8.2 21-21 0-1.4-.1-2.8-.4-4.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.7 18.9 14 24 14c3.4 0 6.5 1.3 8.8 3.4l5.7-5.7C34.7 8 29.6 6 24 6c-7.6 0-14 4.3-17.7 8.7z"/>
              <path fill="#4CAF50" d="M24 42c5.2 0 10.1-2 13.7-5.3l-6.3-5.2C29.2 33.5 26.8 34 24 34c-5.2 0-9.6-3.1-11.4-7.6l-6.6 5.1C9.7 37.7 16.3 42 24 42z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.6-6.1 8-11.3 8-5.2 0-9.6-3.1-11.4-7.6l-6.6 5.1C9.7 37.7 16.3 42 24 42c11.3 0 21-8.2 21-21 0-1.4-.1-2.8-.4-4.5z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Authorized → render nested admin routes
  return <>{children}</>;
}
