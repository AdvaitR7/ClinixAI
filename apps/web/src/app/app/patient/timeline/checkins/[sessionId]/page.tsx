"use client";

import { checkinTypography } from "@/components/checkin-typography";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import type { AiEvidenceResponse, AiSessionView } from "@clinix/schemas";
import { useApiData } from "@/lib/api";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";

/** Binds the omitted timeline detail to the selected AI session, under the patient layout. */
export default function CheckinTimelinePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <CheckinTimeline key={sessionId} sessionId={sessionId} />;
}

/** Presents the saved AI record, provenance and exact answer snapshot without asserting packet sharing. */
function CheckinTimeline({ sessionId }: { sessionId: string }) {
  const result = useApiData<AiSessionView>(`/ai-sessions/${sessionId}`);
  const evidence = useApiData<AiEvidenceResponse>(
    `/ai-sessions/${sessionId}/evidence`,
  );
  const [answersOpen, setAnswersOpen] = useState(false);
  const answersRef = useRef<HTMLButtonElement>(null);
  const session = result.status === "ready" ? result.data : null;
  const outcome = session?.outcome;
  const answers =
    evidence.status === "ready"
      ? evidence.data.sources.filter(
          (s) =>
            s.resource_type === "PATIENT_ANSWER" ||
            s.resource_type === "CURRENT_CONCERN",
        )
      : [];
  const date = session?.completed_at ?? session?.started_at;
  const label =
    outcome?.disposition === "URGENT"
      ? "Urgent assessment"
      : outcome?.disposition === "DOCTOR_REVIEW"
        ? "Doctor review"
        : outcome?.disposition === "SELF_CARE"
          ? "Self-care guidance"
          : "Outcome unavailable";
  return (
    <main
      className={`${checkinTypography} min-h-dvh bg-surface px-6 py-6 text-ink`}
    >
      <div className="mx-auto max-w-[345px]">
        <header className="flex items-center gap-3">
          <Link
            aria-label="Back to timeline"
            href="/app/patient/timeline"
            className="grid size-8 place-items-center text-2xl"
          >
            ←
          </Link>
          <span className="grid size-[38px] place-items-center rounded-xl bg-botanical text-lg text-surface">
            C
          </span>
          <span className="text-2xl">ClinixAI</span>
          <Link
            href="/app/patient/timeline"
            className="ml-auto py-3 text-sm text-[#b89b6a]"
          >
            Close
          </Link>
        </header>
        {result.status === "loading" && (
          <p role="status" className="mt-8">
            Loading timeline entry…
          </p>
        )}
        {result.status === "error" && (
          <section className="mt-8">
            <p role="alert" className="text-sm text-critical">
              {result.error}
            </p>
            <button
              type="button"
              onClick={() => void result.refresh()}
              className="mt-3 min-h-11 text-sm underline"
            >
              Retry entry
            </button>
          </section>
        )}
        {session && (
          <>
            <p className="mt-6 w-fit rounded-full border border-[#dfd3bd] bg-[#f1e8d8] px-3 py-1 text-xs text-botanical">
              AI check-in
            </p>
            <p className="mt-5 text-xs text-graphite">
              {date
                ? new Date(date).toLocaleString("en-IN")
                : "Saved time unavailable"}
            </p>
            <h1 className="mt-4 text-[32px] leading-tight">Check-in record</h1>
            <p className="mt-5 w-fit rounded-full bg-[#f1e8d8] px-3 py-1 text-xs text-botanical">
              AI-derived
            </p>
            <p className="mt-4 text-sm leading-relaxed text-graphite">
              This entry was generated from your check-in answers and saved as a
              separate AI-assisted record.
            </p>
            <section className="mt-4 rounded-[20px] border border-[#dfd3bd] bg-canvas p-5 shadow-sm">
              <div className="flex flex-wrap justify-between gap-2 text-[10px]">
                <span className="rounded-full border border-[#dfd3bd] px-3 py-1">
                  Check-in result
                </span>
                <span
                  className={`rounded-full border px-3 py-1 ${outcome?.disposition === "URGENT" ? "border-critical text-critical" : "border-[#dfd3bd]"}`}
                >
                  {label}
                </span>
              </div>
              <h2 className="mt-4 text-2xl">{label}</h2>
              <p className="mt-3 text-sm leading-relaxed text-graphite">
                {outcome?.summary ??
                  session.error ??
                  "The checked result is not available."}
              </p>
              <Link
                href={`/app/patient/checkin/result/${sessionId}`}
                className="mt-3 inline-flex min-h-11 items-center text-sm text-[#b89b6a]"
              >
                Open full result →
              </Link>
            </section>
            <h2 className="mt-6 text-xl">Provenance</h2>
            <dl className="mt-3 divide-y divide-hairline rounded-[20px] border border-[#dfd3bd] px-5 shadow-sm">
              {[
                ["Derived from", "Your saved check-in answers"],
                [
                  "Saved",
                  date
                    ? new Date(date).toLocaleString("en-IN")
                    : "Time unavailable",
                ],
                ["Record type", "AI assistance · patient record linked"],
              ].map(([term, value]) => (
                <div key={term} className="grid grid-cols-2 gap-4 py-4 text-sm">
                  <dt className="text-xs text-graphite">{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h2 className="mt-6 text-xl">Source documents</h2>
            <p className="mt-3 text-sm text-graphite">
              Open the exact records behind this timeline entry.
            </p>
            <div className="mt-4 space-y-3">
              <button
                ref={answersRef}
                type="button"
                onClick={() => setAnswersOpen(true)}
                className="flex min-h-[74px] w-full items-center justify-between rounded-[20px] border border-[#dfd3bd] p-4 text-left"
              >
                <span>
                  <span className="block text-sm">Check-in answers</span>
                  <span className="mt-1 block text-xs text-graphite">
                    Patient responses ·{" "}
                    {
                      answers.filter(
                        (s) => s.resource_type === "PATIENT_ANSWER",
                      ).length
                    }{" "}
                    questions
                  </span>
                </span>
                <span>›</span>
              </button>
              <Link
                href={`/app/patient/checkin/result/${sessionId}`}
                className="flex min-h-[74px] items-center justify-between rounded-[20px] border border-[#dfd3bd] p-4"
              >
                <span>
                  <span className="block text-sm">Check-in result</span>
                  <span className="mt-1 block text-xs text-graphite">
                    AI-derived · {label.toLowerCase()}
                  </span>
                </span>
                <span>›</span>
              </Link>
              <div className="rounded-[20px] border border-[#dfd3bd] p-4">
                <p className="text-sm">Consultation packet</p>
                <p className="mt-1 text-xs text-graphite">
                  No packet sharing is supported for this record.
                </p>
              </div>
            </div>
          </>
        )}
        {answersOpen && (
          <ClinicalReviewDialog
            titleId="checkin-answers-title"
            busy={false}
            returnFocusRef={answersRef}
            onClose={() => setAnswersOpen(false)}
          >
            <h2 id="checkin-answers-title" className="text-xl">
              Check-in answers
            </h2>
            {evidence.status === "loading" && (
              <p role="status" className="mt-4">
                Loading saved answers…
              </p>
            )}
            {evidence.status === "error" && (
              <>
                <p role="alert" className="mt-4 text-sm text-critical">
                  {evidence.error}
                </p>
                <button
                  type="button"
                  onClick={() => void evidence.refresh()}
                  className="mt-3 min-h-11 text-sm underline"
                >
                  Retry answers
                </button>
              </>
            )}
            {evidence.status === "ready" && (
              <ul className="mt-4 space-y-4">
                {answers.map((answer, i) => (
                  <li
                    key={i}
                    className="break-words rounded-xl border border-hairline p-3 text-sm"
                  >
                    {answer.description}
                  </li>
                ))}
              </ul>
            )}
            {evidence.status === "ready" && !answers.length && (
              <p className="mt-4 text-sm">
                No frozen answer snapshot is available.
              </p>
            )}
          </ClinicalReviewDialog>
        )}
      </div>
    </main>
  );
}
