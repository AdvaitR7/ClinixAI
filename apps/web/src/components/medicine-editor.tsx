"use client";

import type { PrescriptionItemInput } from "@clinix/schemas";
import { useId } from "react";

const FIELDS: { key: keyof PrescriptionItemInput; label: string; wide?: boolean }[] = [
  { key: "medicine_name", label: "Medicine name", wide: true },
  { key: "strength", label: "Strength (e.g. 500mg)" },
  { key: "dose", label: "Dose (e.g. 1 tab)" },
  { key: "route", label: "Route (e.g. Oral)" },
  { key: "frequency", label: "Frequency (e.g. TID)" },
  { key: "timing", label: "Timing (e.g. After food)" },
  { key: "duration", label: "Duration (e.g. 5 days)" },
  { key: "instructions", label: "Instructions", wide: true },
];

const inputClass =
  "mt-1 min-h-[44px] w-full rounded-xl border border-white/10 bg-doctor-panel px-3 font-sans text-sm text-surface outline-none focus:border-copper";

/** Structured medicine rows with accessible reordering and removal. */
export function MedicineEditor({
  items,
  onChange,
}: {
  items: PrescriptionItemInput[];
  onChange: (items: PrescriptionItemInput[]) => void;
}) {
  const fieldId = useId();
  function update(i: number, key: keyof PrescriptionItemInput, value: string) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {items.map((it, i) => (
        <div key={i} className="clinix-doctor-card border-copper/40 p-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
            <p className="clinix-label text-copper">Medication {String(i + 1).padStart(2, "0")}</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move medication ${i + 1} up`}
                className="grid size-7 place-items-center rounded-lg border border-white/10 bg-doctor-panel text-surface disabled:opacity-30"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12l5-5 5 5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                aria-label={`Move medication ${i + 1} down`}
                className="grid size-7 place-items-center rounded-lg border border-white/10 bg-doctor-panel text-surface disabled:opacity-30"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove medication ${i + 1}`}
                className="grid size-7 place-items-center rounded-lg border border-critical/30 bg-critical/10 text-critical"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l8 8M6 14L14 6" />
                </svg>
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.wide ? "col-span-2" : undefined}>
                <label htmlFor={`${fieldId}-${i}-${f.key}`} className="font-sans text-xs text-doctor-muted/70">{f.label}</label>
                <input
                  id={`${fieldId}-${i}-${f.key}`}
                  type="text"
                  value={it[f.key] ?? ""}
                  onChange={(e) => update(i, f.key, e.target.value)}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { medicine_name: "" }])}
        className="min-h-12 w-full rounded-2xl border border-dashed border-copper/50 bg-doctor-panel px-4 font-sans text-xs font-semibold uppercase tracking-wider text-copper transition-colors hover:border-copper"
      >
        + Add another medicine
      </button>
    </div>
  );
}
