import { useEffect, useRef } from "react";

/**
 * Keep the screen awake while the preview is playing (ported from upstream
 * maimai-prober-frontend): playing along means minutes without touching the
 * screen, which would otherwise dim/lock a tablet mid-chart. No-ops silently
 * where the Screen Wake Lock API is missing or denied.
 */
export function useWakeLock(active: boolean): void {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.wakeLock) {
      return;
    }
    let disposed = false;

    const release = () => {
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      void lock?.release().catch(() => {
        // The browser/OS may already have released it.
      });
    };

    const request = async () => {
      if (!active || disposed || wakeLockRef.current) {
        return;
      }
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) {
          void lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener?.("release", () => {
          if (wakeLockRef.current === lock) {
            wakeLockRef.current = null;
          }
        });
      } catch {
        // Denied (battery saver, page hidden, …) — playback works regardless.
      }
    };

    const sync = () => {
      if (active && document.visibilityState === "visible") {
        void request();
      } else {
        release();
      }
    };

    sync();
    // The lock is auto-released when the tab hides; re-acquire on return.
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", sync);
      release();
    };
  }, [active]);
}
