/* =========================================================================
   FILE: frontend/src/main.tsx
   -------------------------------------------------------------------------
   Application bootstrap — renders the React app once the root element exists.
   ========================================================================= */
import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import App from "./App";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Failed to locate the #root element for React to mount.");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
