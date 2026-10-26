"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/** Presents a light source drawer or patient record, containing focus and restoring its invoking control. */
export function VaultDialog({ titleId, returnFocusRef, onClose, busy = false, fullScreen = false, children }: {
  titleId: string;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  busy?: boolean;
  fullScreen?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = returnFocusRef.current ?? document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [returnFocusRef]);
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
        )).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      className={fullScreen ? "fixed inset-0 m-auto h-dvh max-h-dvh w-full max-w-[393px] overflow-y-auto border-0 bg-canvas p-6 text-ink backdrop:bg-ink/20" : "fixed top-[92px] right-[max(0px,calc((100vw_-_393px)/2))] bottom-0 left-auto m-0 max-h-[calc(100dvh_-_92px)] w-[calc(100%_-_1.5rem)] max-w-[350px] overflow-y-auto rounded-[28px] border-0 bg-surface p-5 text-ink shadow-2xl backdrop:bg-ink/20"}>
      {!fullScreen && <div aria-hidden="true" className="mx-auto -mt-2 mb-4 h-[3px] w-11 rounded-full bg-sage/40" />}
      {children}
    </dialog>
  );
}
