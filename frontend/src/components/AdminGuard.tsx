// frontend/src/components/AdminGuard.tsx
import React from "react";
import { useAuth } from "../hooks/useAuth";

function useQueryParam(key: string) {
  const sp = new URLSearchParams(window.location.search);
  return sp.get(key);
}

const AdminGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, isAdmin, user, signIn, signOut } = useAuth();
  const authParam = useQueryParam("auth"); // "denied" | "failed" | null

  if (loading) return <div className="p-6 text-gray-500">Checking admin access…</div>;

  if (!isAdmin) {
    return (
      <div className="min-h-[40vh] grid place-items-center p-8 text-center">
        <div className="max-w-lg">
          <h2 className="text-2xl font-bold mb-2">Admin access required</h2>

          {authParam === "denied" ? (
            <p className="mb-4 text-red-600">
              Your Google account ({user?.email || "not signed in"}) is not on the allow-list.
              If you reached this in error, please reach out to the Too Funny Productions admin team.
            </p>
          ) : authParam === "failed" ? (
            <p className="mb-4 text-red-600">
              Sign-in failed. Please try again or contact the admin team.
            </p>
          ) : (
            <p className="mb-4 opacity-80">
              Sign in with an allow-listed Google account to access the Admin.
            </p>
          )}

          <div className="flex gap-3 justify-center">
            <button
              onClick={signIn}
              className="px-4 py-2 rounded bg-yellow-500 text-black hover:bg-yellow-400"
            >
              Sign in with Google
            </button>
            {user?.email && (
              <button onClick={signOut} className="px-4 py-2 rounded border">
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminGuard;
