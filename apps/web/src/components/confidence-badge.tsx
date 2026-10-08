import { confidenceLabel } from "@clinix/schemas";

const CONF_STYLES: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "border-botanical/40 bg-botanical/10 text-botanical",
  MEDIUM: "border-review/40 bg-review/10 text-review",
  LOW: "border-review/40 bg-review/10 text-review",
};

const CONF_TEXT: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence · review",
};

/**
 * Qualitative OCR confidence chip (DESIGN.md §7: text + color, never color-only).
 * HIGH is neutral-positive; MEDIUM/LOW sit in review amber (uncertainty).
 */
export function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  const label = confidenceLabel(value);
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-sans text-[11px] font-semibold ${CONF_STYLES[label]}`}
    >
      {CONF_TEXT[label]}
    </span>
  );
}
