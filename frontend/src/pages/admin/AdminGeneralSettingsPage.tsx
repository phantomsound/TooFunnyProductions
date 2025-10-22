import React from "react";

import AdminSettingsGeneral from "./AdminSettingsGeneral";

export default function AdminGeneralSettingsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-6 shadow-md">
        <h2 className="text-2xl font-bold text-neutral-900">General Settings</h2>
        <p className="mt-3 text-sm text-neutral-600">
          Tune the global look and feel of Too Funny Productions here. Update the brand copy, upload logos,
          and manage color themes that carry across every page.
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Need per-page tweaks? Jump over to <span className="font-semibold">Page Configurations</span> from the
          sidebar to adjust individual layouts once your global styles are locked in.
        </p>
      </section>

      <section className="rounded-lg bg-white p-6 shadow-md">
        <AdminSettingsGeneral />
      </section>
    </div>
  );
}
