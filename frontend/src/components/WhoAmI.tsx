// frontend/src/components/WhoAmI.tsx
import React from "react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";

export default function WhoAmI() {
  const { user, reload } = useAuth();
  const logout = async () => {
    await fetch(api("/api/auth/logout"), { method: "POST", credentials: "include" });
    await reload();
    window.location.href = "/"; // or "/admin"
  };
  if (!user) return null;
  return (
    <div className="text-right text-xs opacity-80 mb-2">
      Signed in as <span className="font-medium">{user.email}</span> ·{" "}
      <button onClick={logout} className="underline">Sign out</button>
    </div>
  );
}
