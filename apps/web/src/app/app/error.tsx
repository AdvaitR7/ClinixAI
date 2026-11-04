"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for every signed-in workspace page.
 *
 * A render-time throw would otherwise blank the whole route; this keeps the failure contained
 * and lets the user retry the segment. `retry` is the Next 16 name for the old `reset` prop.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-xl p-6" role="alert">
      <section className="clinix-doctor-card p-5">
        <p className="font-sans text-sm text-surface">This page hit a problem.</p>
        <p className="mt-1 font-sans text-xs text-critical">{error.message || "Unexpected error"}</p>
        <button type="button" onClick={() => retry()} className="mt-4 rounded-xl border px-4 py-2 font-sans text-sm">
          Try again
        </button>
      </section>
    </main>
  );
}
