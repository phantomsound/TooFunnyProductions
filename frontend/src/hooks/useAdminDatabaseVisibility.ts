import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "tfp-admin-database-visible";
const EVENT_NAME = "tfp-admin-db-visibility";

export const getAdminDatabaseVisibility = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return false;
    return raw === "true";
  } catch {
    return false;
  }
};

export const setAdminDatabaseVisibility = (visible: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, visible ? "true" : "false");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT_NAME));
};

export const useAdminDatabaseVisibility = () => {
  const [visible, setVisible] = useState(getAdminDatabaseVisibility());

  const refresh = useCallback(() => {
    setVisible(getAdminDatabaseVisibility());
  }, []);

  useEffect(() => {
    window.addEventListener("storage", refresh);
    window.addEventListener(EVENT_NAME, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(EVENT_NAME, refresh);
    };
  }, [refresh]);

  const update = useCallback((next: boolean) => {
    setAdminDatabaseVisibility(next);
    setVisible(next);
  }, []);

  return [visible, update] as const;
};
