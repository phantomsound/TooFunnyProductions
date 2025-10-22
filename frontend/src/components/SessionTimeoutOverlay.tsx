// frontend/src/components/SessionTimeoutOverlay.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../lib/SettingsContext";
import { useAuth } from "../hooks/useAuth";

const COUNTDOWN_SECONDS = 60; // the visible “are you still there?” countdown length

export default function SessionTimeoutOverlay() {
  const { settings, stage, isDirty, save, hasLock, lockedByOther, saving } = useSettings();
  const { isAuthed, refreshSession, logout, loading: authLoading } = useAuth();

  // Minutes to idle before showing countdown → configurable
  const minutes = useMemo(() => {
    const fromSettings = Number((settings as any)?.session_timeout_minutes ?? (settings as any)?.admin_timeout_minutes);
    const fromEnv = Number(import.meta.env.VITE_ADMIN_TIMEOUT_MINUTES);
    return Number.isFinite(fromSettings) && fromSettings > 0
      ? fromSettings
      : Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : 30; // default 30 minutes
  }, [settings]);

  const idleMs = minutes * 60 * 1000;

  const [show, setShow] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const firedRef = useRef(false);      // prevents re-arming
  const idleTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const autoSaveRef = useRef<Promise<void> | null>(null);

  const autoSaveDraft = useCallback(async () => {
    if (autoSaveRef.current) {
      await autoSaveRef.current;
      return;
    }
    if (stage !== "draft" || lockedByOther || !isDirty || !hasLock || saving) return;
    const task = (async () => {
      try {
        await save();
      } catch (error) {
        console.error("Failed to auto-save draft before logout", error);
      }
    })();
    autoSaveRef.current = task.finally(() => {
      autoSaveRef.current = null;
    });
    await autoSaveRef.current;
  }, [stage, lockedByOther, isDirty, hasLock, saving, save]);

  const handleTimeout = useCallback(async () => {
    clearCountdown();
    setShow(false);
    firedRef.current = true;
    try {
      await autoSaveDraft();
    } finally {
      logout();
    }
  }, [autoSaveDraft, logout]);

  function clearIdle() {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function clearCountdown() {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  function resetTimers() {
    clearIdle();
    clearCountdown();
    firedRef.current = false;
    setShow(false);
    setSecondsLeft(COUNTDOWN_SECONDS);
  }

  function armIdle() {
    if (!isAuthed || authLoading || firedRef.current) return;
    clearIdle();
    idleTimerRef.current = window.setTimeout(() => {
      // show countdown once, then never re-arm until page refresh
      firedRef.current = true;
      setSecondsLeft(COUNTDOWN_SECONDS);
      setShow(true);
      clearCountdown();
      countdownRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            void handleTimeout();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }, idleMs);
  }

  // Any user activity resets idle timer (only if not fired yet)
  useEffect(() => {
    if (!isAuthed || authLoading) {
      resetTimers();
      return;
    }
    if (firedRef.current) return;

    const reset = () => {
      if (document.hidden) return;
      clearIdle();
      armIdle();
    };

    const events = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", reset);

    armIdle();
    return () => {
      clearIdle();
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", reset);
    };
  }, [isAuthed, idleMs, authLoading]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
      <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 max-w-sm w-full text-center">
        <h3 className="text-xl font-semibold mb-2">Are you still there?</h3>
        <p className="opacity-80 mb-4">
          You’ll be signed out in <span className="font-mono">{secondsLeft}s</span> due to inactivity.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            className="px-3 py-2 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300"
            onClick={() => {
              clearCountdown();
              setShow(false);
              refreshSession(); // keep logged in
            }}
          >
            Stay signed in
          </button>
          <button
            className="px-3 py-2 rounded border border-neutral-500 hover:bg-neutral-700"
            onClick={() => {
              void (async () => {
                clearCountdown();
                setShow(false);
                await autoSaveDraft();
                logout();
              })();
            }}
          >
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
