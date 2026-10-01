import { healthStatusSchema } from "@clinix/schemas";

// Phase 0 wiring check — proves @clinix/schemas is transpiled/importable from web.
void healthStatusSchema;

export default function PatientPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-botanical px-6 py-4 text-surface">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-sage">
          CliniX
        </p>
        <h1 className="mt-1 font-sans text-2xl font-semibold">
          Patient workspace
        </h1>
      </header>

      <main className="flex-1 space-y-6 px-6 py-8">
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-graphite">
            Today
          </p>
          <p className="mt-1 text-sm text-ink">No upcoming appointment.</p>
        </section>

        <button
          type="button"
          className="w-full rounded-full bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical"
        >
          New check-in
        </button>
      </main>

      <nav className="sticky bottom-0 border-t border-hairline bg-surface px-6 py-3">
        <ul className="flex justify-between font-sans text-xs text-graphite">
          <li className="font-semibold text-botanical">Home</li>
          <li>Timeline</li>
          <li>Vault</li>
          <li>Visits</li>
          <li>Care</li>
        </ul>
      </nav>
    </div>
  );
}
