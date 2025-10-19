export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
export const api = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
