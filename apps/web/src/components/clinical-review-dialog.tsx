"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ClinixBrand } from "@/components/clinix-brand";

/**
 * Contains review focus, supports Escape/Close, and returns focus to the invoking action.
 * `appearance="clear"` only swaps the surface and header; the dialog lifecycle, focus loop and busy lock are shared.
 */
export function ClinicalReviewDialog({
  titleId,
  busy,
  onClose,
  returnFocusRef,
  children,
  appearance = "legacy",
}: {
  titleId: string;
  busy: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  appearance?: "legacy" | "clear";
}) {
  const clear = appearance === "clear";
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const returnFocus = returnFocusRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (returnFocus) returnFocus.focus();
      else if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
        )).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      data-ui={clear ? "clear" : undefined}
      className={clear
        ? "fixed inset-0 m-auto min-h-dvh max-h-dvh w-full max-w-[430px] overflow-y-auto border-0 bg-clear-surface p-6 text-clear-ink shadow-2xl backdrop:bg-clear-ink/40 md:min-h-0 md:max-w-[560px] md:max-h-[calc(100dvh_-_2rem)] md:rounded-[28px]"
        : "fixed inset-0 m-auto min-h-dvh max-h-dvh w-full max-w-[393px] overflow-y-auto border-0 bg-ink p-6 text-surface shadow-2xl backdrop:bg-ink/70 md:min-h-0 md:max-h-[calc(100dvh_-_2rem)] md:rounded-[28px]"}
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        {clear ? <ClinixBrand appearance="clear" /> : <span className="inline-flex items-center gap-2.5 font-sans text-2xl">
          <span aria-hidden="true" className="grid size-[38px] place-items-center rounded-xl bg-copper text-lg font-bold text-ink">C</span>
          ClinixAI
        </span>}
        <button type="button" onClick={onClose} disabled={busy} className={`min-h-11 px-2 font-sans text-xs disabled:opacity-60 ${clear ? "text-clear-action" : "text-evidence"}`}>Close</button>
      </header>
      {children}
    </dialog>
  );
}
