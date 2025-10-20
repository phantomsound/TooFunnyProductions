const defaultApiBase = (() => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:5000";
})();

export const API_BASE = (import.meta.env.VITE_API_URL || defaultApiBase).replace(/\/$/, "");
export const api = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
