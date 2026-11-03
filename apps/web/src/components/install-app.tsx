"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Subscribes to display-mode changes so the control disappears once the app is installed. */
function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when running as an installed app (including iOS standalone). */
function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True for iOS Safari, which has no install prompt and needs Share → Add to Home Screen. */
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Module-level store: `beforeinstallprompt` fires once per page load, so it is captured at the app root and read anywhere. */
let deferredPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

/** Replaces the captured prompt and tells subscribers. */
function setDeferredPrompt(next: InstallPromptEvent | null) {
  deferredPrompt = next;
  promptListeners.forEach((listener) => listener());
}

/** Mounted once in the root layout so the install prompt is never missed by a page that mounts later. */
export function InstallPromptCapture() {
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

/** Subscribes to the captured prompt. */
function subscribePrompt(onChange: () => void) {
  promptListeners.add(onChange);
  return () => {
    promptListeners.delete(onChange);
  };
}

/** Tracks whether this device can offer an install: a captured prompt, or iOS Safari instructions. Never true once installed. */
export function useInstallState() {
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => true);
  const prompt = useSyncExternalStore(subscribePrompt, () => deferredPrompt, () => null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setIos(isIosSafari()));
  }, []);

  return { available: !standalone && (Boolean(prompt) || ios), prompt, setPrompt: setDeferredPrompt };
}

/**
 * Install action for the PWA.
 * Chromium browsers get a native prompt through `beforeinstallprompt`; iOS Safari gets a short instruction.
 * Renders nothing when already installed or when the browser offers no install path.
 */
export function InstallApp() {
  const { available, prompt, setPrompt } = useInstallState();

  if (!available) return null;

  /** Shows the browser's install dialog; the prompt can only be used once. */
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }

  return (
    <section id="install" className="clinix-card p-5">
      <h2 className="clinix-label text-graphite">Install</h2>
      {prompt ? (
        <button type="button" onClick={() => void install()} className="mt-3 min-h-12 w-full rounded-[1.125rem] bg-botanical px-4 font-sans text-sm font-semibold text-surface">
          Install CliniX
        </button>
      ) : (
        <p className="mt-2 font-sans text-sm leading-6 text-ink">Tap Share, then Add to Home Screen.</p>
      )}
    </section>
  );
}
