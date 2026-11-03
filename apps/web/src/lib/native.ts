"use client";

/**
 * Helpers for running inside the Capacitor Android shell (apps/mobile), which loads this site via server.url.
 * Every function is a no-op in a normal browser, so the web app behaves exactly as before there.
 */

import { Capacitor } from "@capacitor/core";

/** Must match `appendUserAgent` in apps/mobile/capacitor.config.ts. */
export const NATIVE_USER_AGENT_MARKER = "CliniXApp";

/**
 * Resolves true once the Capacitor bridge reports a native platform.
 *
 * The native bridge is injected into remote pages shortly after scripts start, so a synchronous
 * check can wrongly say "browser". This polls briefly (about 3 s) before giving up.
 */
export async function detectNativeApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // apps/mobile appends this marker to the WebView user agent, so ordinary browsers skip the polling.
  if (!navigator.userAgent.includes(NATIVE_USER_AGENT_MARKER)) return false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (Capacitor.isNativePlatform()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Wires the Android hardware back button to browser history, and closes the app at the first screen.
 * Without this, Android would close the app on every back press (Capacitor core does not handle it).
 *
 * @returns A cleanup function that removes the listener.
 */
export async function registerNativeBackButton(): Promise<() => void> {
  if (!(await detectNativeApp())) return () => {};
  const { App } = await import("@capacitor/app");
  const handle = await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
  return () => void handle.remove();
}

/** Converts a Blob to base64 (without the data-URL prefix) for the Filesystem plugin. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Shows a generated PDF to the user.
 *
 * In a browser it opens the temporary object URL in a new tab. In the Android shell a blob URL cannot be
 * opened externally, so the file is written to the cache directory and handed to the system share sheet.
 *
 * @param blob The PDF returned by the API.
 * @param objectUrl A blob URL for the same data, used for the browser path.
 * @param filename Name for the cached file in the native path.
 */
export async function openOrSharePdf(blob: Blob, objectUrl: string, filename: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.open(objectUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const written = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  await Share.share({ title: filename, url: written.uri, dialogTitle: "Prescription" });
}
