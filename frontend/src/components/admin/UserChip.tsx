import React from "react";
import { api } from "../../lib/api";

export default function UserChip() {
  const [me, setMe] = React.useState<{ user: { email:string, name:string, picture?:string }|null }|null>(null);

  React.useEffect(() => {
    (async () => {
      const r = await fetch(api("/api/auth/me"), { credentials: "include" });
      const d = await r.json();
      setMe(d);
    })();
  }, []);

  const logout = async () => {
    await fetch(api("/api/auth/logout"), { method: "POST", credentials: "include" });
    window.location.href = "/admin";
  };

  if (!me?.user) return null;

  return (
    <div className="flex items-center gap-3">
      {me.user.picture && (
        <img src={me.user.picture} alt="" className="h-8 w-8 rounded-full border" />
      )}
      <div className="text-right">
        <div className="text-sm font-semibold text-gray-700">{me.user.name}</div>
        <div className="text-xs text-gray-500">{me.user.email}</div>
      </div>
      <button
        onClick={logout}
        className="ml-2 rounded bg-gray-200 px-3 py-1 text-sm font-medium hover:bg-gray-300"
      >
        Logout
      </button>
    </div>
  );
}
