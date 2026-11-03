"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to the browser's online/offline events. */
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Non-floating banner shown while the device is offline.
 * Writes already fail with an honest error; this only makes the reason visible.
 */
export function ConnectionStatus({ className = "" }: { className?: string }) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div className={className}>
      <p role="status" className="mx-6 rounded-2xl border border-review bg-review/10 px-4 py-3 font-sans text-xs font-medium text-review">
        Offline. Changes can&apos;t be saved until you reconnect.
      </p>
    </div>
  );
}
