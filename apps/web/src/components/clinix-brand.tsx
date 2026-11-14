import { UiIcon } from "@/components/ui-icon";

/** Renders the shared brand: the approved Clear v2 mark (30px jade tile with a plus) and wordmark. */
export function ClinixBrand() {
  return (
    <span data-brand="clear" className="inline-flex items-center gap-2.5" aria-label="ClinixAI">
      <span
        aria-hidden="true"
        className="grid size-[30px] place-items-center rounded-[10px] bg-clear-action text-white"
      >
        <UiIcon name="plus" size={14} />
      </span>
      <span className="text-[19px] font-semibold leading-[27px] tracking-[-0.02em] text-clear-ink">
        ClinixAI
      </span>
    </span>
  );
}
