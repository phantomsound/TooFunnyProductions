/* =========================================================================
   FILE: frontend/src/components/admin/AdminShell.tsx
   -------------------------------------------------------------------------
   Fixed layout admin shell with sidebar and top-right user bar.
   ========================================================================= */
import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import AdminUserBar from "./AdminUserBar";

export default function AdminShell() {
  return (
    <div className="min-h-[80vh] grid grid-cols-[260px_1fr] gap-0 bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <aside className="border-r border-neutral-800 bg-neutral-900">
        <div className="p-5 text-xl font-bold text-yellow-400">Admin</div>
        <nav className="px-3 py-2 space-y-1">
          <NavLink
            to="/admin/settings"
            className={({ isActive }) =>
              "block rounded px-3 py-2 hover:bg-neutral-800 " +
              (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
            }
          >
            ⚙️ Settings
          </NavLink>
          <NavLink
            to="/admin/media"
            className={({ isActive }) =>
              "block rounded px-3 py-2 hover:bg-neutral-800 " +
              (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
            }
          >
            🎬 Media Manager
          </NavLink>
          <NavLink
            to="/admin/audit"
            className={({ isActive }) =>
              "block rounded px-3 py-2 hover:bg-neutral-800 " +
              (isActive ? "bg-neutral-800 text-yellow-300" : "text-neutral-200")
            }
          >
            🧾 Audit Log
          </NavLink>
        </nav>
      </aside>

      {/* Main */}
      <main className="min-h-[80vh]">
        <div className="flex items-center justify-end border-b border-neutral-800 bg-neutral-900 px-4 py-2">
          <AdminUserBar />
        </div>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
