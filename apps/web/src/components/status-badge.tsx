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
};

/** Text + color status chip (DESIGN.md §7: never color-only). */
export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "border-hairline bg-surface text-graphite";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-sans text-[11px] font-semibold ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
