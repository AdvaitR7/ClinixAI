const STATUS_STYLES: Record<string, string> = {
  REQUESTED: "border-review/40 bg-review/10 text-review",
  CONFIRMED: "border-botanical/40 bg-botanical/10 text-botanical",
  COMPLETED: "border-graphite/40 bg-graphite/10 text-graphite",
  CANCELLED: "border-critical/40 bg-critical/10 text-critical",
  NO_SHOW: "border-critical/40 bg-critical/10 text-critical",
  OPEN: "border-botanical/40 bg-botanical/10 text-botanical",
  WAITING_FOR_PATIENT: "border-review/40 bg-review/10 text-review",
  WAITING_FOR_DOCTOR: "border-review/40 bg-review/10 text-review",
  UNCLAIMED: "border-review/40 bg-review/10 text-review",
  ACTIVE: "border-botanical/40 bg-botanical/10 text-botanical",
  // Phase 3 — prescription draft/status + medication tri-state
  DRAFT: "border-graphite/40 bg-graphite/10 text-graphite",
  NEEDS_REVIEW: "border-review/40 bg-review/10 text-review",
  APPROVED: "border-botanical/40 bg-botanical/10 text-botanical",
  REJECTED: "border-critical/40 bg-critical/10 text-critical",
  EXPIRED: "border-hairline bg-surface text-graphite",
  SUPERSEDED: "border-hairline bg-surface text-graphite",
  CURRENT: "border-botanical/40 bg-botanical/10 text-botanical",
  PAST: "border-graphite/40 bg-graphite/10 text-graphite",
  UNKNOWN_STATUS: "border-review/40 bg-review/10 text-review",
  PAID: "border-botanical/40 bg-botanical/10 text-botanical",
  UNPAID: "border-review/40 bg-review/10 text-review",
  WAIVED: "border-hairline bg-surface text-graphite",
  // Phase 4 — document processing states
  UPLOADED: "border-graphite/40 bg-graphite/10 text-graphite",
  PROCESSING: "border-review/40 bg-review/10 text-review",
  FAILED: "border-critical/40 bg-critical/10 text-critical",
};

type StatusTone = "positive" | "review" | "urgent" | "neutral";

const STATUS_TONES: Record<string, StatusTone> = {
  CONFIRMED: "positive", OPEN: "positive", ACTIVE: "positive", APPROVED: "positive", CURRENT: "positive", PAID: "positive",
  REQUESTED: "review", WAITING_FOR_PATIENT: "review", WAITING_FOR_DOCTOR: "review", UNCLAIMED: "review",
  NEEDS_REVIEW: "review", UNKNOWN_STATUS: "review", UNPAID: "review", PROCESSING: "review",
  CANCELLED: "urgent", NO_SHOW: "urgent", REJECTED: "urgent", FAILED: "urgent",
};

/**
 * Text + color status chip (DESIGN.md §7: never color-only).
 * `data-tone` only feeds the opt-in Clear styling; the status text and legacy classes are unchanged,
 * and any status without an explicit tone stays neutral rather than guessing a meaning.
 */
export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "border-hairline bg-surface text-graphite";
  return (
    <span
      data-tone={STATUS_TONES[status] ?? "neutral"}
      className={`clinix-badge inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 font-sans text-xs font-bold uppercase leading-none tracking-[0.04em] ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
