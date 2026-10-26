/** Renders the shared brand, including the text mark used by focused clinical frames. */
export function ClinixBrand({ inverted = false, monogram = false }: { inverted?: boolean; monogram?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="ClinixAI">
      <span
        aria-hidden="true"
        className={`grid size-[38px] place-items-center rounded-xl ${
          inverted ? "bg-copper text-ink" : "bg-botanical text-surface"
        }`}
      >
        {monogram ? <span className="font-sans text-lg font-bold">C</span> : <svg viewBox="0 0 24 24" className="size-5" fill="none">
          <path
            d="M12 2.5c.65 5.3 4.2 8.85 9.5 9.5-5.3.65-8.85 4.2-9.5 9.5C11.35 16.2 7.8 12.65 2.5 12 7.8 11.35 11.35 7.8 12 2.5Z"
            fill="currentColor"
          />
        </svg>}
      </span>
      <span
        className={`font-sans text-[22px] font-semibold tracking-[-0.03em] ${
          inverted ? "text-surface" : "text-botanical"
        }`}
      >
        ClinixAI
      </span>
    </span>
  );
}
