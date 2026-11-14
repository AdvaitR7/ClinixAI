"use client";

import type { PrescriptionItemInput } from "@clinix/schemas";
import { useId } from "react";

/** A medicine line plus its review state: `needs_review` comes from the saved draft, `reviewed` is the doctor's unsaved confirmation. */
export type EditorItem = PrescriptionItemInput & { needs_review?: boolean; reviewed?: boolean; confidence?: number | null };

/** Suggestions only: the fields stay free text so uncommon regimens are never blocked. */
const OPTIONS: Partial<Record<keyof PrescriptionItemInput, string[]>> = {
  route: ["Oral", "Topical", "Inhalation", "Intramuscular", "Intravenous", "Subcutaneous", "Ophthalmic", "Otic", "Nasal"],
  frequency: ["Once daily", "Twice daily", "Three times daily", "Four times daily", "Every 8 hours", "As needed"],
  timing: ["Before food", "After food", "With food", "At bedtime", "Morning", "Empty stomach"],
};

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

/** Class sets for the two appearances. Only presentation differs; every handler and field is shared. */
const LOOK = {
  legacy: {
    card: "clinix-doctor-card border-copper/40 p-4",
    head: "flex items-center justify-between border-b border-white/5 pb-2.5",
    title: "clinix-label text-copper",
    iconButton: "grid size-11 place-items-center rounded-lg border border-white/10 bg-doctor-panel text-surface disabled:opacity-30",
    removeButton: "grid size-11 place-items-center rounded-lg border border-critical/30 bg-critical/10 text-critical",
    review: "mt-3 rounded-xl border border-review/60 bg-review/10 p-3 font-sans text-xs text-surface",
    reviewTitle: "font-bold uppercase text-review",
    checkbox: "size-5 accent-copper",
    label: "font-sans text-xs text-doctor-muted/70",
    input: inputClass,
    add: "min-h-12 w-full rounded-2xl border border-dashed border-copper/50 bg-doctor-panel px-4 font-sans text-xs font-semibold uppercase tracking-wider text-copper transition-colors hover:border-copper",
  },
  clear: {
    card: "clear-card p-4",
    head: "flex items-center justify-between border-b border-clear-divider pb-2.5",
    title: "clinix-label text-clear-action",
    iconButton: "grid size-11 place-items-center rounded-lg border border-clear-divider bg-clear-surface text-clear-ink disabled:opacity-30",
    removeButton: "grid size-11 place-items-center rounded-lg border border-clear-urgent/30 bg-[#f8e1e1] text-clear-urgent",
    review: "mt-3 rounded-xl border border-clear-review/60 bg-[#f8ecd4] p-3 font-sans text-xs text-clear-ink",
    reviewTitle: "font-bold uppercase text-clear-review",
    checkbox: "size-5 accent-clear-action",
    label: "text-xs text-clear-secondary",
    input: "clear-field mt-1",
    add: "min-h-12 w-full rounded-2xl border border-dashed border-clear-action/50 bg-clear-surface px-4 text-xs font-semibold uppercase tracking-wider text-clear-action transition-colors hover:border-clear-action",
  },
} as const;

/** Structured medicine rows with accessible reordering and removal. */
export function MedicineEditor({
  items,
  onChange,
  blankItem = { medicine_name: "" },
  appearance = "legacy",
}: {
  items: EditorItem[];
  onChange: (items: EditorItem[]) => void;
  blankItem?: EditorItem;
  /** Temporary migration switch; "clear" restyles to the light Clear v2 surface. */
  appearance?: "legacy" | "clear";
}) {
  const look = LOOK[appearance];
  const fieldId = useId();
  function update(i: number, key: keyof PrescriptionItemInput, value: string) {
    // Changing a value invalidates an earlier confirmation of that line.
    onChange(items.map((it, idx) => (idx === i ? { ...it, [key]: value, ...(it.needs_review ? { reviewed: false } : {}) } : it)));
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
        <div key={i} className={look.card}>
          <div className={look.head}>
            <p className={look.title}>Medication {String(i + 1).padStart(2, "0")}</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move medication ${i + 1} up`}
                className={look.iconButton}
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
                className={look.iconButton}
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove medication ${i + 1}`}
                className={look.removeButton}
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l8 8M6 14L14 6" />
                </svg>
              </button>
            </div>
          </div>
          {it.needs_review && (
            <div className={look.review}>
              <p className={look.reviewTitle}>
                Ambiguous{typeof it.confidence === "number" ? ` · Confidence ${Math.round(it.confidence * 100)}%` : ""}
              </p>
              <p className="mt-1">This line is not final until you compare it with the source.</p>
              <label className="mt-2 flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!it.reviewed}
                  onChange={(e) => onChange(items.map((row, idx) => (idx === i ? { ...row, reviewed: e.target.checked } : row)))}
                  className={look.checkbox}
                />
                I checked medication {i + 1} against the source
              </label>
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.wide ? "col-span-2" : undefined}>
                <label htmlFor={`${fieldId}-${i}-${f.key}`} className={look.label}>{f.label}</label>
                <input
                  id={`${fieldId}-${i}-${f.key}`}
                  type="text"
                  value={(it[f.key] as string | undefined) ?? ""}
                  onChange={(e) => update(i, f.key, e.target.value)}
                  list={OPTIONS[f.key] ? `${fieldId}-${f.key}-options` : undefined}
                  className={look.input}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {Object.entries(OPTIONS).map(([key, values]) => (
        <datalist key={key} id={`${fieldId}-${key}-options`}>{values!.map((value) => <option key={value} value={value} />)}</datalist>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { ...blankItem }])}
        className={look.add}
      >
        + Add another medicine
      </button>
    </div>
  );
}
