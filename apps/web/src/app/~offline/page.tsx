"use client";

import { ClinixBrand } from "@/components/clinix-brand";

/** Static fallback shown by the service worker when a page cannot be reached. */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 text-ink">
      <div className="w-full max-w-[393px]">
        <ClinixBrand />
        <h1 className="mt-10 font-sans text-[2rem] font-bold leading-[1.1] tracking-[-0.04em]">You are offline</h1>
        <p className="mt-3 font-sans text-sm leading-6 text-graphite">Reconnect to continue. Nothing is saved on this device.</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-8 min-h-12 w-full rounded-2xl bg-botanical px-5 font-sans text-sm font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evidence"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
