const getWindowOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return null;
};

const defaultApiBase = getWindowOrigin() ?? "http://localhost:5000";

const envApiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

const shouldUseEnvBase = (() => {
  if (!envApiBase) return false;
  if (!/^https?:\/\/localhost(?::\d+)?$/i.test(envApiBase)) return true;

  const origin = getWindowOrigin();
  return !origin || /^https?:\/\/localhost(?::\d+)?$/i.test(origin);
})();

export const API_BASE = (shouldUseEnvBase ? envApiBase : defaultApiBase).replace(/\/$/, "");
export const api = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
