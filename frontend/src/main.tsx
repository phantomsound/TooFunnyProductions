/* =========================================================================
   FILE: frontend/src/main.tsx
   ========================================================================= */
// frontend/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";             // <-- this line is essential
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


// 1) Always show *something* immediately
const rootEl = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootEl);
root.render(
  <div style={{ minHeight: "100vh", background: "#0b0b0b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{ opacity: 0.8, fontFamily: "system-ui, sans-serif" }}>Booting…</div>
  </div>
);

// 2) If anything goes wrong before React mounts the real app, write it to the page.
function showFatal(err: unknown) {
  console.error("Fatal boot error:", err);
  const msg =
    (err instanceof Error && (err.stack || err.message)) ||
    String(err ?? "Unknown error");
  root.render(
    <div style={{ minHeight: "100vh", background: "#0b0b0b", color: "#fff", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: 0 }}>Boot failed.</h1>
      <p style={{ opacity: 0.8 }}>See the details below and the browser console.</p>
      <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</pre>
    </div>
  );
}

// 3) Dynamically import the heavy bits so we can catch module-evaluation errors cleanly.
(async () => {
  try {
    const [{ default: App }, { SettingsProvider }] = await Promise.all([
      import("./App"),
      import("./lib/SettingsContext"),
    ]);
    const [{ default: ErrorBoundary }] = await Promise.all([
      import("./components/ErrorBoundary").catch(() => ({ default: ({ children }: any) => <>{children}</> })), // just in case
    ]);

    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </ErrorBoundary>
      </React.StrictMode>
    );
  } catch (err) {
    showFatal(err);
  }
})();

// 4) Also catch “early” unhandled errors and promise rejections.
window.addEventListener("error", (e) => {
  if (!document.getElementById("__boot_failed")) showFatal(e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  if (!document.getElementById("__boot_failed")) showFatal(e.reason);
});
