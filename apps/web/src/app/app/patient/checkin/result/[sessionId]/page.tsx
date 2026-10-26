"use client";

import { checkinTypography } from "@/components/checkin-typography";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  aiSessionViewSchema,
  type AiEvidenceResponse,
  type AiSessionView,
} from "@clinix/schemas";
import { fetchApi, useApiData } from "@/lib/api";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { CheckinSafety } from "@/components/checkin-safety";

/** Resets all result state when navigating between patient check-in sessions. */
export default function CheckinResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <CheckinResult key={sessionId} sessionId={sessionId} />;
}

/** Renders checked outcomes and actual evidence; never reconstructs a clinical conclusion locally. */
function CheckinResult({ sessionId }: { sessionId: string }) {
  const { getToken } = useAuth();
  const [session, setSession] = useState<AiSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [evidence, setEvidence] = useState<AiEvidenceResponse | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [dialog, setDialog] = useState<"basis" | "scope" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const evidenceRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    /** Stops polling on terminal states, errors, unmount or a bounded two-minute wait. */
    async function poll() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Authentication required");
        const data = aiSessionViewSchema.parse(
          await fetchApi<AiSessionView>(token, `/ai-sessions/${sessionId}`, {
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        setSession(data);
        if (data.status === "SUCCEEDED" || data.status === "FAILED") return;
        if (++polls >= 60) {
          setWaiting(true);
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load result",
          );
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      evidenceRequest.current?.abort();
    };
  }, [getToken, sessionId, attempt]);

  /** Reads the frozen evidence snapshot, with retry and cancellation on session exit. */
  async function loadEvidence() {
    evidenceRequest.current?.abort();
    const controller = new AbortController();
    evidenceRequest.current = controller;
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      const data = await fetchApi<AiEvidenceResponse>(
        token,
        `/ai-sessions/${sessionId}/evidence`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setEvidence(data);
      return data;
    } catch (cause) {
      if (!controller.signal.aborted)
        setEvidenceError(
          cause instanceof Error ? cause.message : "Could not load evidence",
        );
      return null;
    } finally {
      if (!controller.signal.aborted) setEvidenceLoading(false);
    }
  }

  /** Opens a source or scope review and returns keyboard focus to that exact action. */
  function openDialog(kind: "basis" | "scope", button: HTMLButtonElement) {
    actionRef.current = button;
    setDialog(kind);
    if (!evidence && !evidenceLoading) void loadEvidence();
  }

  /** Exports only this checked result and its actual evidence; it grants no doctor access. */
  async function downloadResult() {
    setExportError(null);
    const sources = evidence ?? (await loadEvidence());
    if (!sources) {
      setExportError(
        "Download requires the result evidence. Retry when it is available.",
      );
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ai_assisted: true,
            not_a_diagnosis: true,
            session_id: sessionId,
            outcome: session?.outcome,
            evidence: sources.sources,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clinix-checkin-${sessionId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Rechecks persisted status without discarding the completed check-in or creating a new analysis. */
  function retry() {
    setError(null);
    setWaiting(false);
    setAttempt((value) => value + 1);
  }

  const outcome = session?.outcome;
  const terminal =
    session?.status === "SUCCEEDED" || session?.status === "FAILED";
  if (
    error ||
    session?.status === "FAILED" ||
    (session?.status === "SUCCEEDED" &&
      (!outcome?.disposition || session.error))
  ) {
    return (
      <main className={`${checkinTypography} min-h-dvh bg-canvas px-6 py-12`}>
        <div className="mx-auto max-w-[345px]">
          <h1 className="text-2xl text-ink">Check-in result unavailable</h1>
          <p role="alert" className="mt-4 text-sm text-critical">
            {error ??
              session?.error ??
              "Analysis could not complete. Your submitted answers remain in your record."}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 min-h-11 rounded-xl bg-ink px-5 text-sm text-surface"
          >
            Retry status
          </button>
          <div className="mt-5 flex gap-5 text-sm underline">
            <Link href="/app/patient/checkin">New check-in</Link>
            <Link href="/app/patient">Return to Dashboard</Link>
          </div>
        </div>
      </main>
    );
  }
  if (!terminal || !outcome)
    return (
      <main className={`${checkinTypography} min-h-dvh bg-canvas px-6 py-12`}>
        <div className="mx-auto max-w-[345px] text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink text-xl text-surface">
            C
          </div>
          <h1 className="mt-6 text-2xl text-ink">
            {waiting
              ? "Analysis is taking longer than expected"
              : "Preparing your check-in result…"}
          </h1>
          <p role="status" className="mt-3 text-sm text-graphite">
            {waiting
              ? "Your answers are saved. Check the status again shortly."
              : "We will show the checked result when analysis finishes."}
          </p>
          {waiting && (
            <button
              type="button"
              onClick={retry}
              className="mt-5 min-h-11 rounded-xl bg-ink px-5 text-sm text-surface"
            >
              Check status again
            </button>
          )}
          <Link
            href="/app/patient"
            className="mt-6 inline-block min-h-11 text-sm underline"
          >
            Return to Dashboard
          </Link>
        </div>
      </main>
    );
  if (outcome.disposition === "URGENT" || outcome.requires_urgent_escalation)
    return <UrgentResult sessionId={sessionId} summary={outcome.summary} />;

  const review = outcome.disposition === "DOCTOR_REVIEW";
  const labs =
    evidence?.sources.filter(
      (source) => source.resource_type === "LAB_REPORT",
    ) ?? [];
  return (
    <main
      className={`${checkinTypography} min-h-dvh bg-[#f6f0e6] px-6 pb-12 pt-6 text-[#1f1f1f]`}
    >
      <div className="mx-auto max-w-[345px]">
        <header className="flex items-center gap-3">
          <Link
            href="/app/patient"
            aria-label="Back to home"
            className="grid size-8 place-items-center text-2xl"
          >
            ←
          </Link>
          <span className="grid size-[38px] place-items-center rounded-xl bg-[#1f1f1f] text-lg text-[#fbf8f1]">
            C
          </span>
          <span className="text-2xl">ClinixAI</span>
          <Link
            href="/app/patient"
            className="ml-auto py-3 text-xs text-[#b8a06b]"
          >
            Done
          </Link>
        </header>
        <p className="mt-6 w-fit rounded-full border border-[#e7dccb] bg-[#fbf8f1] px-3 py-1.5 text-[9px] text-[#5f5a52]">
          ◆ AI-ASSISTED RESULT
        </p>
        <h1 className="mt-6 text-[32px] leading-tight">Check-in complete</h1>
        <p className="mt-3 text-xs leading-relaxed text-[#5f5a52]">
          Review the result separately from your answers, then choose what
          happens next.
        </p>
        <section className="mt-6">
          <p className="text-[9px] tracking-wider uppercase">
            AI ASSISTANCE · {review ? "DOCTOR REVIEW" : "CHECKED GUIDANCE"}
          </p>
          <div className="mt-3 rounded-[24px] bg-[#fbf8f1] p-5 shadow-sm">
            <span
              className={`inline-block rounded-full px-3 py-1.5 text-[10px] text-surface ${review ? "bg-review" : "bg-[#1f1f1f]"}`}
            >
              {review ? "DOCTOR REVIEW" : "SELF-CARE GUIDANCE"}
            </span>
            <h2 className="mt-4 text-xl">{outcome.summary}</h2>
            <p className="mt-3 text-xs leading-relaxed text-[#5f5a52]">
              Uncertainty: {outcome.uncertainty_level.toLowerCase()}. This is
              not a diagnosis; seek care if symptoms worsen or change.
            </p>
            <button
              type="button"
              onClick={(event) => openDialog("basis", event.currentTarget)}
              className="mt-4 min-h-11 w-full text-right text-[10px] text-[#b8a06b]"
            >
              View result basis
            </button>
          </div>
        </section>
        <section className="mt-6">
          <p className="text-[10px] tracking-wider text-[#5f5a52] uppercase">
            {review ? "NEXT STEPS" : "NEXT 24–48 HOURS"}
          </p>
          <h2 className="mt-3 text-xl">
            {review ? "Prepare for doctor review" : "Self-care guidance"}
          </h2>
          <div className="mt-4 space-y-3">
            {outcome.low_risk_guidance.map((guide, index) => (
              <p
                key={index}
                className="rounded-[20px] bg-[#fbf8f1] p-4 text-sm shadow-sm"
              >
                {guide}
              </p>
            ))}
            {!outcome.low_risk_guidance.length && (
              <p className="rounded-[20px] bg-[#fbf8f1] p-4 text-sm">
                No self-care guidance was included in the checked result.
              </p>
            )}
            <aside className="rounded-[20px] border border-review bg-review/5 p-4">
              <h3 className="text-[10px] font-semibold text-review uppercase">
                Important medication warning
              </h3>
              <p className="mt-2 text-xs leading-relaxed">
                {outcome.statutory_warning}
              </p>
            </aside>
          </div>
        </section>
        <section className="mt-6">
          <p className="text-[10px] tracking-wider text-[#5f5a52] uppercase">
            PATIENT RECORD
          </p>
          <div className="mt-3 rounded-[24px] bg-[#fbf8f1] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-hairline pb-3">
              <h2 className="text-base">Similar past episodes</h2>
              <span className="text-[10px]">
                {outcome.historical_matches.length} found
              </span>
            </div>
            <div className="divide-y divide-hairline">
              {outcome.historical_matches.map((match, index) => (
                <div key={index} className="py-3 text-xs">
                  <p>
                    {match.date
                      ? new Date(match.date).toLocaleDateString("en-IN")
                      : "Date unavailable"}{" "}
                    · {match.chief_concern ?? "Past episode"}
                  </p>
                  <p className="mt-2 text-[10px] text-[#5f5a52]">
                    {match.similarity_label.replaceAll("_", " ")}
                  </p>
                  {match.supporting_features.length > 0 && (
                    <p className="mt-2">
                      Similarities: {match.supporting_features.join(", ")}
                    </p>
                  )}
                  {match.differences.length > 0 && (
                    <p className="mt-2">
                      Differences: {match.differences.join(", ")}
                    </p>
                  )}
                  {match.outcome && (
                    <p className="mt-2">Recorded outcome: {match.outcome}</p>
                  )}
                </div>
              ))}
            </div>
            {!outcome.historical_matches.length && (
              <p className="mt-3 text-xs text-[#5f5a52]">
                No previous matching episodes recorded.
              </p>
            )}
            <Link
              href="/app/patient/timeline"
              className="mt-3 block min-h-11 pt-3 text-right text-[10px] text-[#b8a06b]"
            >
              View timeline →
            </Link>
          </div>
        </section>
        <section className="mt-6">
          <p className="text-[10px] tracking-wider text-[#5f5a52] uppercase">
            RELEVANT LABS
          </p>
          <div className="mt-3 rounded-[24px] bg-[#fbf8f1] p-5 shadow-sm">
            <h2 className="text-base">Linked records</h2>
            <p className="mt-1 text-[10px] text-[#5f5a52]">
              From the frozen check-in evidence
            </p>
            <div className="mt-3 divide-y divide-hairline border-t border-hairline">
              {labs.map((lab, i) => (
                <p key={i} className="py-3 text-xs">
                  {lab.description}
                  {lab.date
                    ? ` · ${new Date(lab.date).toLocaleDateString("en-IN")}`
                    : ""}
                </p>
              ))}
            </div>
            {!labs.length && (
              <p className="mt-3 text-xs text-[#5f5a52]">
                {evidence
                  ? "No lab observations linked."
                  : "Open result basis to load linked evidence."}
              </p>
            )}
            <Link
              href="/app/patient/vault"
              className="mt-3 block min-h-11 pt-3 text-right text-[10px] text-[#b8a06b]"
            >
              Review reports →
            </Link>
          </div>
        </section>
        <section className="mt-6">
          <h2 className="text-[10px] tracking-wider text-[#5f5a52] uppercase">
            MISSING INFORMATION
          </h2>
          <p className="mt-3 text-xs text-[#5f5a52]">
            Optional measurements cannot yet be added to this saved analysis.
          </p>
          <div className="mt-3 rounded-[24px] bg-[#fbf8f1] p-5 text-xs shadow-sm">
            {outcome.questions_for_doctor.length ? (
              <ul className="list-disc space-y-3 pl-4">
                {outcome.questions_for_doctor.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            ) : (
              <p>
                No additional questions were included in the checked result.
              </p>
            )}
          </div>
        </section>
        <section className="mt-6 rounded-[24px] border-[5px] border-[#ece2d1] bg-[#fbf8f1] p-5">
          <p className="text-[9px] uppercase">CONSULTATION PACKET</p>
          <h2 className="mt-3 text-xl">Sharing unavailable</h2>
          <p className="mt-3 text-xs leading-relaxed text-[#5f5a52]">
            This result is saved to your record. Booking a visit does not share
            this result or grant access to other records. Scoped packet consent
            is not yet supported.
          </p>
          <button
            type="button"
            onClick={(event) => openDialog("scope", event.currentTarget)}
            className="mt-3 min-h-11 w-full text-right text-[10px] text-[#b8a06b]"
          >
            Review sharing scope
          </button>
        </section>
        <div className="mt-6 space-y-3">
          <Link
            href="/app/patient/book"
            className="flex min-h-[64px] items-center justify-between rounded-[20px] bg-[#1f1f1f] px-5 text-sm text-[#fbf8f1]"
          >
            BOOK DOCTOR{" "}
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-full bg-[#fbf8f1] text-xl text-ink"
            >
              →
            </span>
          </Link>
          <Link
            href="/app/patient/timeline"
            className="flex min-h-[54px] items-center justify-between rounded-[18px] border border-hairline bg-[#fbf8f1] px-5 text-xs"
          >
            SAVED TO RECORD · VIEW TIMELINE <span>→</span>
          </Link>
          <div className="flex gap-3">
            <button
              type="button"
              disabled
              className="min-h-[48px] flex-1 rounded-2xl bg-[#fbf8f1] text-xs opacity-50"
            >
              SHARE PACKET
            </button>
            <button
              type="button"
              disabled={evidenceLoading}
              onClick={() => void downloadResult()}
              className="min-h-[48px] flex-1 rounded-2xl bg-[#fbf8f1] text-xs disabled:opacity-50"
            >
              DOWNLOAD RESULT
            </button>
          </div>
          {exportError && (
            <p role="alert" className="text-xs text-critical">
              {exportError}
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-[9px] text-[#5f5a52]">
          AI-assisted result · not a diagnosis · based on your answers and
          selected records
        </p>
        {dialog && (
          <ClinicalReviewDialog
            titleId="result-review-title"
            busy={false}
            returnFocusRef={actionRef}
            onClose={() => setDialog(null)}
          >
            <h2 id="result-review-title" className="text-xl text-ink">
              {dialog === "basis" ? "Result basis" : "Sharing scope"}
            </h2>
            {dialog === "scope" && (
              <p className="mt-4 text-sm text-graphite">
                No packet or doctor-access grant has been created. Downloading
                this result creates a local copy only. The evidence below
                describes analysis inputs, not a sharing authorization.
              </p>
            )}
            <p className="mt-4 text-sm text-graphite">
              AI-derived · uncertainty {outcome.uncertainty_level.toLowerCase()}{" "}
              · {outcome.statutory_warning}
            </p>
            {evidenceLoading && (
              <p role="status" className="mt-4 text-sm">
                Loading evidence…
              </p>
            )}
            {evidenceError && (
              <p role="alert" className="mt-4 text-sm text-critical">
                {evidenceError}
              </p>
            )}
            {evidenceError && (
              <button
                type="button"
                onClick={() => void loadEvidence()}
                className="mt-3 min-h-11 text-sm underline"
              >
                Retry evidence
              </button>
            )}
            {evidence && (
              <ul className="mt-4 space-y-4">
                {evidence.sources.map((source, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-hairline p-3 text-sm"
                  >
                    <p className="text-[10px] text-graphite">
                      {source.resource_type.replaceAll("_", " ")}
                    </p>
                    <p className="mt-2 break-words">{source.description}</p>
                    {source.date && (
                      <p className="mt-2 text-xs">
                        {new Date(source.date).toLocaleDateString("en-IN")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {evidence && !evidence.sources.length && (
              <p className="mt-4 text-sm">
                No source references are available for this result.
              </p>
            )}
          </ClinicalReviewDialog>
        )}
      </div>
    </main>
  );
}

/** Keeps emergency actions visible while loading the actual saved answers for read-only review. */
function UrgentResult({
  sessionId,
  summary,
}: {
  sessionId: string;
  summary: string;
}) {
  const evidence = useApiData<AiEvidenceResponse>(
    `/ai-sessions/${sessionId}/evidence`,
  );
  const answers =
    evidence.status === "ready"
      ? evidence.data.sources
          .filter(
            (source) =>
              source.resource_type === "PATIENT_ANSWER" ||
              source.resource_type === "CURRENT_CONCERN",
          )
          .map((source) => source.description)
      : [];
  return (
    <CheckinSafety
      alert={{
        severity: "CRITICAL",
        action: "BLOCK_NORMAL_FLOW",
        triggered_rule_ids: [],
        message: summary,
        emergency_number: "112 / 108",
      }}
      answers={
        answers.length
          ? answers
          : [
              evidence.status === "error"
                ? "Saved answers could not be loaded. Urgent assessment is still required."
                : "The checked analysis requires urgent assessment. Saved answers are not available yet.",
            ]
      }
      reviewNote="These are the saved analysis inputs. Specific triggering-answer attribution is unavailable; reviewing them does not resume the check-in."
    />
  );
}
