/* =========================================================================
   FILE: frontend/src/components/ToastProvider.tsx
   -------------------------------------------------------------------------
   Minimal toast system for success/error/informational popups.
   ========================================================================= */
import React, { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
type ToastCtx = { toast: (t: Omit<Toast, "id">) => void };

const ToastContext = createContext<ToastCtx | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed right-3 top-3 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              "rounded px-3 py-2 shadow text-sm " +
              (t.kind === "success"
                ? "bg-green-600 text-white"
                : t.kind === "error"
                ? "bg-red-600 text-white"
                : "bg-neutral-800 text-white")
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx.toast;
}
