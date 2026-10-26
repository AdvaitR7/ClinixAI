"use client";

import { checkinTypography } from "@/components/checkin-typography";
import { useRef, useState } from "react";
import type { SafetyAlert } from "@clinix/schemas";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";

/** Keeps urgent care actions available while the patient reviews their triggering answers. */
export function CheckinSafety({
  alert,
  answers,
  reviewNote,
}: {
  alert: SafetyAlert;
  answers: string[];
  reviewNote?: string;
}) {
  const [reviewing, setReviewing] = useState(false);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const number = alert.emergency_number.match(/\d+/)?.[0] ?? "112";
  return (
    <main
      className={`${checkinTypography} min-h-dvh bg-surface px-6 py-6 md:py-10`}
    >
      <div className="mx-auto max-w-[345px]">
        <div className="flex items-center gap-3 text-botanical">
          <span className="grid size-[38px] place-items-center rounded-xl bg-botanical text-lg text-surface">
            C
          </span>
          <span className="text-2xl">ClinixAI</span>
        </div>
        <p className="mt-7 w-fit rounded-full border border-critical px-3 py-1.5 text-[10px] text-critical">
          SAFETY CHECK
        </p>
        <div className="mt-6 grid size-[54px] place-items-center rounded-[18px] bg-critical text-3xl text-surface">
          !
        </div>
        <h1 className="mt-5 text-[32px] leading-tight text-ink">
          Get urgent medical help now
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-graphite">
          Your answers include signs that need urgent in-person assessment. This
          check-in is paused.
        </p>
        <section className="mt-10 rounded-[22px] border border-critical p-5 ring-4 ring-critical/10">
          <h2 className="text-[9px] text-critical uppercase">
            Why this appeared
          </h2>
          <p className="mt-3 text-xs text-graphite">{alert.message}</p>
          {reviewNote && (
            <p className="mt-3 text-xs text-graphite">{reviewNote}</p>
          )}
          <ul className="mt-3 list-disc space-y-1 break-words pl-4 text-xs text-ink">
            {answers.map((answer, i) => (
              <li key={i}>{answer}</li>
            ))}
          </ul>
        </section>
        <div className="mt-9 space-y-3">
          <a
            href={`tel:${number}`}
            className="flex min-h-[60px] items-center justify-center gap-3 rounded-[20px] bg-critical p-4 text-xs text-surface"
          >
            CALL EMERGENCY SERVICES{" "}
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-full bg-surface text-xl text-critical"
            >
              →
            </span>
          </a>
          <a
            href="https://maps.google.com/?q=emergency+hospital+near+me"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[54px] items-center justify-center rounded-[18px] border border-critical p-3 text-center text-xs text-critical"
          >
            FIND NEAREST EMERGENCY DEPARTMENT
          </a>
        </div>
        <p className="mt-6 rounded-2xl bg-canvas p-4 text-xs leading-relaxed text-graphite">
          If possible, ask someone to stay with you while you get help.
        </p>
        <button
          ref={reviewRef}
          type="button"
          onClick={() => setReviewing(true)}
          className="mt-5 min-h-11 w-full text-center text-xs text-evidence underline"
        >
          Review the answers that triggered this alert
        </button>
        {reviewing && (
          <ClinicalReviewDialog
            titleId="safety-review-title"
            busy={false}
            onClose={() => setReviewing(false)}
            returnFocusRef={reviewRef}
          >
            <h2 id="safety-review-title" className="text-xl text-ink">
              Answers for this safety alert
            </h2>
            <p className="mt-3 text-sm text-critical">
              {alert.message} This check-in remains paused.
            </p>
            {reviewNote && (
              <p className="mt-3 text-xs text-graphite">{reviewNote}</p>
            )}
            <ul className="mt-4 list-disc space-y-2 break-words pl-5 text-sm text-ink">
              {answers.map((answer, i) => (
                <li key={i}>{answer}</li>
              ))}
            </ul>
            <a
              href={`tel:${number}`}
              className="mt-6 block rounded-xl bg-critical p-4 text-center text-sm text-surface"
            >
              CALL EMERGENCY SERVICES
            </a>
          </ClinicalReviewDialog>
        )}
      </div>
    </main>
  );
}
