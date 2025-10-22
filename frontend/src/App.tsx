// frontend/src/App.tsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Providers / chrome
import ThemeProvider from "./components/ThemeProvider";
import MaintenanceGate from "./components/MaintenanceGate";
import DevErrorBoundary from "./components/DevErrorBoundary";
import { SettingsProvider } from "./lib/SettingsContext";

import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import SessionTimeoutOverlay from "./components/SessionTimeoutOverlay";

// Public pages
import Home from "./pages/Home";
import About from "./pages/About";
import Events from "./pages/Events";
import Media from "./pages/Media";
import Merch from "./pages/Merch";
import Contact from "./pages/Contact";

// Admin
import AuthGuard from "./components/admin/AuthGuard";
import AdminShell from "./components/admin/AdminShell";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminMediaManager from "./pages/admin/AdminMediaManager";
import AdminAudit from "./pages/admin/AdminAudit";

export default function App() {
  return (
    <BrowserRouter>
      {/* Put SettingsProvider at the very top so everything can use useSettings() */}
      <SettingsProvider>
        <ThemeProvider>
          <DevErrorBoundary>
            <MaintenanceGate>
              <div className="min-h-screen">
                <Navbar />
                <SessionTimeoutOverlay />

                <Routes>
                  {/* Public */}
                  <Route path="/" element={<Home />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/media" element={<Media />} />
                  <Route path="/merch" element={<Merch />} />
                  <Route path="/contact" element={<Contact />} />

                  {/* Admin */}
                  <Route
                    path="/admin"
                    element={
                      <AuthGuard>
                        <AdminShell />
                      </AuthGuard>
                    }
                  >
                    <Route index element={<AdminSettings />} />
                    <Route path="settings" element={<AdminSettings />} />
                    <Route path="media" element={<AdminMediaManager />} />
                    <Route path="audit" element={<AdminAudit />} />
                  </Route>

                  {/* Fallback */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>

                <Footer />
              </div>
            </MaintenanceGate>
          </DevErrorBoundary>
        </ThemeProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
