"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AiSessionView } from "@clinix/schemas";
import { fetchApi } from "@/lib/api";

export default function CheckinResultPage() {
  const { getToken } = useAuth();
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [sessionData, setSessionData] = useState<AiSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedToVault, setSavedToVault] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    async function checkStatus() {
      try {
        const token = await getToken();
        if (!token) return;

        const data = await fetchApi<AiSessionView>(token, `/ai-sessions/${sessionId}`);
        setSessionData(data);

        if (data.status === "SUCCEEDED" || data.status === "FAILED") {
          setLoading(false);
        } else {
          // Still running -> Poll again in 2s
          setPollCount((c) => c + 1);
          timer = setTimeout(checkStatus, 2000);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to load check-in result");
        setLoading(false);
      }
    }

    checkStatus();
    return () => clearTimeout(timer);
  }, [sessionId, getToken]);

  if (loading) {
    return (
      <main className="min-h-dvh bg-canvas px-6 py-12">
        <div className="mx-auto max-w-[393px] text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-botanical text-xl font-bold text-surface">
            C
          </div>
          <h1 className="mt-6 font-sans text-2xl font-bold text-ink">
            Synthesizing clinical assessment...
          </h1>
          <p className="mt-2 font-sans text-xs text-graphite">
            Analyst 1 and Analyst 2 are reviewing your answers independently.
          </p>
          <div className="mt-6 flex justify-center">
            <div className="size-8 animate-spin rounded-full border-2 border-botanical border-t-transparent" />
          </div>
          <p className="mt-4 font-mono text-[10px] text-graphite/70">
            Poll cycle {pollCount + 1}
          </p>
        </div>
      </main>
    );
  }

  if (errorMsg || sessionData?.status === "FAILED") {
    return (
      <main className="min-h-dvh bg-canvas px-6 py-12">
        <div className="mx-auto max-w-[393px] text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-critical text-xl font-bold text-surface">
            !
          </div>
          <h1 className="mt-6 font-sans text-xl font-bold text-ink">
            Check-in analysis encountered an issue
          </h1>
          <p className="mt-2 font-sans text-xs text-critical">
            {errorMsg ?? sessionData?.error ?? "Analysis could not complete."}
          </p>
          <Link
            href="/app/patient"
            className="mt-6 inline-block rounded-xl bg-botanical px-6 py-3 font-sans text-xs font-semibold text-surface"
          >
            Return to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const outcome = sessionData?.outcome;

  return (
    <main className="min-h-dvh bg-[#f7f1e7] px-6 pb-12 pt-6">
      <div className="mx-auto max-w-[393px]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link href="/app/patient" className="font-sans text-2xl text-ink hover:opacity-80">
            ←
          </Link>
          <div className="flex items-center gap-2">
            <div className="grid size-[38px] place-items-center rounded-[12px] bg-ink font-sans text-lg font-bold text-surface">
              C
            </div>
            <span className="font-sans text-2xl font-semibold text-ink">ClinixAI</span>
          </div>
          <Link
            href="/app/patient"
            className="font-sans text-xs font-semibold text-copper hover:underline"
          >
            Done
          </Link>
        </div>

        {/* Result Chip */}
        <div className="mt-6">
          <span className="inline-block rounded-full border border-[#e7dccb] bg-surface px-3 py-1 font-sans text-[9px] font-semibold tracking-wider text-graphite uppercase">
            ◆ AI-assisted result
          </span>
        </div>

        {/* Intro */}
        <h1 className="mt-3 font-sans text-[32px] font-medium leading-tight text-ink">
          Check-in complete
        </h1>
        <p className="mt-1 font-sans text-xs leading-relaxed text-graphite">
          Review the result separately from your answers, then choose what happens next.
        </p>

        {/* Section: Outcome Card */}
        <div className="mt-6">
          <p className="font-sans text-[9px] font-semibold tracking-wider text-ink uppercase">
            AI ASSISTANCE · LOW-RISK PATTERN
          </p>
          <div className="mt-2 rounded-[24px] bg-surface p-5 shadow-sm">
            <span className="inline-block rounded-full bg-ink px-3 py-1 font-sans text-[10px] font-semibold tracking-wide text-surface uppercase">
              LOW RISK
            </span>
            <h2 className="mt-3 font-sans text-xl font-medium text-ink">
              {outcome?.summary ?? "Self-care is appropriate"}
            </h2>
            <p className="mt-1.5 font-sans text-xs leading-relaxed text-graphite">
              For now, no red-flag answers were identified in this check-in. This is not
              a diagnosis; seek care if symptoms worsen or change.
            </p>
            <p className="mt-3 text-right font-sans text-[10px] font-semibold text-copper">
              View result basis
            </p>
          </div>
        </div>

        {/* Section: Next 24-48 Hours Self-Care Guidance */}
        <div className="mt-6">
          <p className="font-sans text-[10px] font-semibold tracking-wider text-graphite uppercase">
            NEXT 24–48 HOURS
          </p>
          <h2 className="mt-1 font-sans text-xl font-medium text-ink">
            Self-care guidance
          </h2>

          <div className="mt-3 space-y-2.5">
            {outcome?.low_risk_guidance.map((guide, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-[20px] bg-surface p-4 shadow-sm"
              >
                <div className="mt-1 size-2.5 shrink-0 rounded-full bg-copper" />
                <div>
                  <p className="font-sans text-sm font-medium text-ink">{guide}</p>
                </div>
              </div>
            ))}

            {/* Mandatory Statutory Warning Box */}
            <div className="rounded-[20px] border border-review bg-review/5 p-4 shadow-sm">
              <p className="font-sans text-[10px] font-bold tracking-wider text-review uppercase">
                Important medication warning
              </p>
              <p className="mt-1.5 font-sans text-xs leading-relaxed font-medium text-ink">
                {outcome?.statutory_warning ??
                  "Prior treatment is not authorization for reuse. Medicines prescribed for earlier episodes should never be restarted without consulting a doctor."}
              </p>
            </div>
          </div>
        </div>

        {/* Section: Similar Past Episodes */}
        <div className="mt-6">
          <p className="font-sans text-[10px] font-semibold tracking-wider text-graphite uppercase">
            PATIENT RECORD
          </p>

          <div className="mt-2 rounded-[24px] bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="font-sans text-base font-medium text-ink">
                Similar past episodes
              </h3>
              <span className="font-sans text-[10px] font-semibold text-graphite">
                {outcome?.historical_matches.length ?? 0} found
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {outcome?.historical_matches && outcome.historical_matches.length > 0 ? (
                outcome.historical_matches.map((m, i) => (
                  <div key={i} className="py-1">
                    <div className="flex items-center justify-between">
                      <p className="font-sans text-xs font-medium text-ink">
                        {m.date ? new Date(m.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Past episode"} · {m.chief_concern ?? "Cough"}
                      </p>
                      <span className="rounded-full bg-evidence/20 px-2 py-0.5 font-mono text-[9px] font-semibold text-botanical uppercase">
                        {m.similarity_label.replace("_", " ")}
                      </span>
                    </div>
                    {m.supporting_features.length > 0 && (
                      <p className="mt-1 font-sans text-[11px] text-graphite">
                        Similarities: {m.supporting_features.join(", ")}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="font-sans text-xs text-graphite">
                  No previous matching episodes recorded.
                </p>
              )}
            </div>

            <div className="mt-3 border-t border-hairline pt-2 text-right">
              <Link
                href="/app/patient/timeline"
                className="font-sans text-[10px] font-semibold text-copper hover:underline"
              >
                View timeline →
              </Link>
            </div>
          </div>
        </div>

        {/* Section: Relevant Linked Labs */}
        <div className="mt-6">
          <p className="font-sans text-[10px] font-semibold tracking-wider text-graphite uppercase">
            RELEVANT LABS
          </p>

          <div className="mt-2 rounded-[24px] bg-surface p-5 shadow-sm">
            <div className="border-b border-hairline pb-2">
              <h3 className="font-sans text-base font-medium text-ink">Linked records</h3>
              <p className="font-sans text-[10px] text-graphite">
                From your selected patient record
              </p>
            </div>

            <div className="mt-3 divide-y divide-hairline">
              <div className="flex items-center justify-between py-2">
                <span className="font-sans text-xs font-semibold text-ink">Recent CBC</span>
                <span className="font-sans text-[10px] text-graphite">Imported result</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="font-sans text-xs font-semibold text-ink">Vitamin D</span>
                <span className="font-sans text-[10px] text-graphite">Imported result</span>
              </div>
            </div>

            <div className="mt-3 text-right">
              <Link
                href="/app/patient/vault"
                className="font-sans text-[10px] font-semibold text-copper hover:underline"
              >
                Review reports →
              </Link>
            </div>
          </div>
        </div>

        {/* Section: Consultation Packet */}
        <div className="mt-6 rounded-[24px] bg-[#efe5d5] p-1.5">
          <div className="rounded-[20px] bg-surface p-5 shadow-sm">
            <p className="font-sans text-[9px] font-semibold tracking-wider text-ink uppercase">
              CONSULTATION PACKET
            </p>
            <h3 className="mt-1 font-sans text-lg font-medium text-ink">
              Scoped for this concern
            </h3>
            <p className="mt-1 font-sans text-[10px] text-graphite">
              Includes · this check-in · similar episodes · selected labs
            </p>
            <p className="font-sans text-[10px] text-graphite">
              Does not include unrelated records.
            </p>
            <p className="mt-2 text-right font-sans text-[10px] font-semibold text-copper">
              Review sharing scope
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 space-y-3">
          <Link
            href={`/app/patient/book?packetId=${sessionId}${sessionData?.encounter_id ? `&encounterId=${sessionData.encounter_id}` : ""}`}
            className="flex min-h-[64px] w-full items-center justify-between rounded-[20px] bg-ink px-5 py-4 font-sans text-sm font-semibold tracking-wide text-surface shadow transition-transform active:translate-y-px"
          >
            <span>BOOK DOCTOR + PACKET</span>
            <span className="grid size-8 place-items-center rounded-full bg-surface text-base font-bold text-ink">
              →
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setSavedToVault(true)}
            className="flex min-h-[54px] w-full items-center justify-between rounded-[18px] border border-hairline bg-surface px-5 py-3 font-sans text-xs font-semibold tracking-wide text-ink shadow-sm transition-transform active:translate-y-px"
          >
            <span>{savedToVault ? "SAVED TO HEALTH VAULT ✓" : "SAVE TO VAULT"}</span>
            <span className="grid size-7 place-items-center rounded-full bg-ink text-sm font-bold text-surface">
              →
            </span>
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-[16px] bg-surface font-sans text-xs font-semibold text-ink shadow-sm hover:bg-white"
            >
              SHARE PACKET
            </button>
            <button
              type="button"
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-[16px] bg-surface font-sans text-xs font-semibold text-ink shadow-sm hover:bg-white"
            >
              DOWNLOAD PACKAGE
            </button>
          </div>
        </div>

        <p className="mt-6 text-center font-sans text-[9px] text-graphite/80">
          AI-assisted result · not a diagnosis · based on your answers and selected records
        </p>
      </div>
    </main>
  );
}
