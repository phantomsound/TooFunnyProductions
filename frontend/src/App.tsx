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
import AdminContactResponses from "./pages/admin/AdminContactResponses";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminGeneralSettingsPage from "./pages/admin/AdminGeneralSettingsPage";
import AdminDatabaseWorkspace from "./pages/admin/AdminDatabaseWorkspace";
import { useAdminDatabaseVisibility } from "./hooks/useAdminDatabaseVisibility";

export default function App() {
  const [databaseVisible] = useAdminDatabaseVisibility();

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
                    <Route index element={<AdminGeneralSettingsPage />} />
                    <Route path="general" element={<AdminGeneralSettingsPage />} />
                    <Route
                      path="database"
                      element={databaseVisible ? <AdminDatabaseWorkspace /> : <Navigate to="/admin/general" replace />}
                    />
                    <Route path="page-configurations" element={<AdminSettings />} />
                    <Route path="settings" element={<Navigate to="/admin/page-configurations" replace />} />
                    <Route path="media" element={<AdminMediaManager />} />
                    <Route path="contact-responses" element={<AdminContactResponses />} />
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
