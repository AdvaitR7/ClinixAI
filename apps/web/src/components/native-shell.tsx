"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { registerNativeBackButton } from "@/lib/native";

type MobileRelease = { version: string; download_url: string };

/** Compares dotted numeric Android versions without relying on string ordering. */
function isNewerVersion(candidate: string, current: string): boolean {
  const nextParts = candidate.match(/\d+/g)?.map(Number) ?? [];
  const currentParts = current.match(/\d+/g)?.map(Number) ?? [];
  for (let index = 0; index < Math.max(nextParts.length, currentParts.length); index += 1) {
    const difference = (nextParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * Mounted once in the root layout. Inside the Android shell it connects the hardware back button to
 * browser history; in a normal browser it renders nothing and does nothing.
 */
export function NativeShell() {
  const [offline, setOffline] = useState(false);
  const [release, setRelease] = useState<MobileRelease | null>(null);
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void registerNativeBackButton().then((remove) => {
      if (cancelled) remove();
      else cleanup = remove;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const updateOnline = () => setOffline(!navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    if (navigator.onLine) {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/v1\/?$/, "");
      if (apiBase) {
        void fetch(`${apiBase}/mobile/release`, { cache: "no-store" })
          .then((response) => response.ok ? response.json() as Promise<MobileRelease> : null)
          .then((latest) => {
            const current = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
            if (!latest || !isNewerVersion(latest.version.replace(/^android-v/, ""), current)) return;
            const download = new URL(latest.download_url);
            if (download.protocol !== "https:" || download.hostname !== "github.com" || !download.pathname.startsWith("/AdvaitR7/ClinixAI/releases/tag/")) return;
            setRelease(latest);
          })
          .catch(() => {});
      }
    }

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  if (!offline && !release) return null;
  return <div role="status" className="fixed inset-x-3 top-3 z-[100] flex items-center justify-between gap-3 rounded-xl border border-copper bg-graphite px-4 py-3 text-sm text-surface shadow-xl">
    <span>{offline ? "You are offline. Reconnect to load or save health records." : "A new CliniX update is available."}</span>
    {release && <a href={release.download_url} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-copper">Open release</a>}
  </div>;
}
