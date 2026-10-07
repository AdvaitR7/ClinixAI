"use client";

import type { PrescriptionItemInput } from "@clinix/schemas";

const FIELDS: { key: keyof PrescriptionItemInput; label: string; wide?: boolean }[] = [
  { key: "medicine_name", label: "Medicine", wide: true },
  { key: "strength", label: "Strength" },
  { key: "dose", label: "Dose" },
  { key: "route", label: "Route" },
  { key: "frequency", label: "Frequency" },
  { key: "timing", label: "Timing" },
  { key: "duration", label: "Duration" },
  { key: "instructions", label: "Instructions", wide: true },
];

const inputClass =
  "h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper";

/** Structured medicine rows (DESIGN.md §4: distinct fields for dose/route/frequency/timing/duration). */
export function MedicineEditor({
  items,
  onChange,
}: {
  items: PrescriptionItemInput[];
  onChange: (items: PrescriptionItemInput[]) => void;
}) {
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
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-2xl border border-hairline bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs font-semibold text-graphite">Medicine {i + 1}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-full border border-hairline px-2 py-0.5 font-sans text-xs disabled:opacity-40">
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded-full border border-hairline px-2 py-0.5 font-sans text-xs disabled:opacity-40">
                ↓
              </button>
              <button type="button" onClick={() => remove(i)} className="rounded-full border border-hairline px-2 py-0.5 font-sans text-xs text-critical">
                ✕
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.wide ? "col-span-2" : undefined}>
                <label className="font-sans text-xs text-graphite">{f.label}</label>
                <input
                  type="text"
                  value={it[f.key] ?? ""}
                  onChange={(e) => update(i, f.key, e.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { medicine_name: "" }])}
        className="w-full rounded-full border border-dashed border-hairline bg-surface px-4 py-3 font-sans text-sm font-semibold text-graphite"
      >
        + Add medicine
      </button>
    </div>
  );
}
