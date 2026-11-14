"use client";

import { checkinTypography } from "@/components/checkin-typography";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  InteractionBlockView,
  InteractionResponseResult,
  SafetyAlert,
} from "@clinix/schemas";
import { CheckinSafety } from "@/components/checkin-safety";
import { fetchApi } from "@/lib/api";
import { recordHref } from "@/lib/route-params";

type SavedQuestion = {
  block: InteractionBlockView;
  answer: {
    selectedOptionIds: string[] | null;
    freeText: string | null;
  } | null;
};
type SavedCheckin = {
  session: { id: string; encounterId: string; status: string };
  chief_concern: string | null;
  total_steps: number;
  history: SavedQuestion[];
  safety_alert: SafetyAlert | null;
};

/** Resumes saved questions, restores prior answers, and keeps safety interruptions blocking. */
export default function PatientCheckinPage() {
  const { getToken } = useAuth();
  const router = useRouter();

  // State
  const [chiefConcern, setChiefConcern] = useState("");
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeBlock, setActiveBlock] = useState<InteractionBlockView | null>(
    null,
  );
  const [stepNumber, setStepNumber] = useState(1);
  const [totalSteps, setTotalSteps] = useState(3);
  const [history, setHistory] = useState<SavedQuestion[]>([]);
  const [ready, setReady] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const requestBusy = useRef(false);

  // Answer selection
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [showBasis, setShowBasis] = useState(false);

  // Emergency interrupt state (Screen 6a)
  const [isEmergency, setIsEmergency] = useState(false);
  const [safetyAlert, setSafetyAlert] = useState<SafetyAlert | null>(null);
  const [emergencyTriggers, setEmergencyTriggers] = useState<string[]>([]);

  /** Applies the server's durable session without inferring safety or question progress. */
  function applySaved(data: SavedCheckin) {
    setChiefConcern(data.chief_concern ?? "");
    setEncounterId(data.session.encounterId);
    setSessionId(data.session.id);
    setHistory(data.history);
    setTotalSteps(data.total_steps);
    const last = data.history.at(-1);
    setActiveBlock(last?.block ?? null);
    setStepNumber(last?.block.sequence_number ?? 1);
    setSelectedOptionId(last?.answer?.selectedOptionIds?.[0] ?? null);
    setFreeText(last?.answer?.freeText ?? "");
    setReady(data.session.status === "COMPLETED");
    setStarted(true);
    if (data.session.status === "ESCALATED" && data.safety_alert) {
      setSafetyAlert(data.safety_alert);
      setIsEmergency(true);
      setEmergencyTriggers([
        data.chief_concern ?? "Current concern",
        ...data.history.flatMap((h) =>
          h.answer
            ? [
                h.answer.freeText ||
                  h.block.options
                    ?.filter((o) => h.answer?.selectedOptionIds?.includes(o.id))
                    .map((o) => o.label)
                    .join(", ") ||
                  "Saved answer",
              ]
            : [],
        ),
      ]);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const id = new URL(window.location.href).searchParams.get("interactionId");
    if (!id) {
      queueMicrotask(() => setRestoring(false));
      return;
    }
    /** Loads the owner-checked session when returning to or reloading a check-in. */
    async function resume() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Authentication required");
        const data = await fetchApi<SavedCheckin>(
          token,
          `/interactions/${id}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) applySaved(data);
      } catch (err) {
        if (!controller.signal.aborted)
          setErrorMsg(
            err instanceof Error ? err.message : "Could not restore check-in",
          );
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    }
    void resume();
    return () => controller.abort();
  }, [getToken]);

  /** Restores a real prior block and its saved answer; changes invalidate later answers on submit. */
  function goBack() {
    if (loading) return;
    const previous = history.find(
      (h) => h.block.sequence_number === stepNumber - 1,
    );
    if (!previous) {
      setStarted(false);
      return;
    }
    setActiveBlock(previous.block);
    setStepNumber(previous.block.sequence_number);
    setSelectedOptionId(previous.answer?.selectedOptionIds?.[0] ?? null);
    setFreeText(previous.answer?.freeText ?? "");
    setReady(false);
    setErrorMsg(null);
  }

  /** Starts or retries analysis from durable completed answers. */
  async function startAnalysis(token: string, id: string) {
    const data = await fetchApi<{ ai_session_id: string }>(
      token,
      `/encounters/${id}/ai-analysis`,
      { method: "POST" },
    );
    router.push(recordHref("/app/patient/checkin/result", "sessionId", data.ai_session_id));
  }

  /** Creates or resumes a durable encounter/session, preserving retries and safety state. */
  async function handleStartCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!chiefConcern.trim() || requestBusy.current) return;
    requestBusy.current = true;
    setLoading(true);
    setErrorMsg(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");

      // Create encounter first
      const encRes = encounterId
        ? { encounter_id: encounterId }
        : await fetchApi<{ encounter_id: string }>(
            token,
            "/patients/self/encounters",
            {
              method: "POST",
              body: JSON.stringify({
                encounter_type: "AI_SELF_CARE",
                chief_concern: chiefConcern.trim(),
              }),
            },
          );
      const newEncId = encRes.encounter_id;
      setEncounterId(newEncId);

      // Start interaction session
      const startRes = await fetchApi<{
        interaction_session_id: string;
        status: string;
        next_block?: InteractionBlockView;
        safety_alert?: SafetyAlert;
        total_steps?: number;
      }>(token, `/encounters/${newEncId}/interaction/start`, {
        method: "POST",
        body: JSON.stringify({ chief_concern: chiefConcern.trim() }),
      });

      window.history.replaceState(
        window.history.state,
        "",
        `?interactionId=${encodeURIComponent(startRes.interaction_session_id)}`,
      );
      setSessionId(startRes.interaction_session_id);
      if (startRes.status === "RESUME") {
        applySaved(
          await fetchApi<SavedCheckin>(
            token,
            `/interactions/${startRes.interaction_session_id}`,
          ),
        );
        return;
      }
      if (startRes.status === "SAFETY_ESCALATION" && startRes.safety_alert) {
        setIsEmergency(true);
        setSafetyAlert(startRes.safety_alert);
        setEmergencyTriggers([chiefConcern]);
        return;
      }

      setSessionId(startRes.interaction_session_id);
      setActiveBlock(startRes.next_block ?? null);
      setTotalSteps(startRes.total_steps ?? 3);
      setHistory(
        startRes.next_block
          ? [{ block: startRes.next_block, answer: null }]
          : [],
      );
      setStepNumber(1);
      setStarted(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to start check-in",
      );
    } finally {
      requestBusy.current = false;
      setLoading(false);
    }
  }

  /** Saves the displayed block, then advances, interrupts, or retries analysis from saved answers. */
  async function handleContinue() {
    if (!sessionId || !activeBlock || requestBusy.current) return;
    if (
      !ready &&
      ((!selectedOptionId && !freeText.trim()) ||
        (selectedOptionId === "other" && !freeText.trim()))
    ) {
      setErrorMsg("Please select an answer or describe your symptoms.");
      return;
    }

    requestBusy.current = true;
    setLoading(true);
    setErrorMsg(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");

      if (ready && encounterId) {
        await startAnalysis(token, encounterId);
        return;
      }
      const res = await fetchApi<InteractionResponseResult>(
        token,
        `/interactions/${sessionId}/responses`,
        {
          method: "POST",
          body: JSON.stringify({
            block_id: activeBlock.id,
            selected_option_ids: selectedOptionId ? [selectedOptionId] : [],
            free_text: freeText.trim() || null,
          }),
        },
      );

      const answered = {
        block: activeBlock,
        answer: {
          selectedOptionIds: selectedOptionId ? [selectedOptionId] : [],
          freeText,
        },
      };
      setHistory((saved) => [
        ...saved.filter((h) => h.block.sequence_number < stepNumber),
        answered,
        ...(res.next_block ? [{ block: res.next_block, answer: null }] : []),
      ]);
      // Red-flag Safety Interrupt triggered (Screen 6a)
      if (res.status === "SAFETY_ESCALATION" && res.safety_alert) {
        setIsEmergency(true);
        setSafetyAlert(res.safety_alert);
        setEmergencyTriggers([
          chiefConcern,
          freeText ||
            activeBlock.options?.find((o) => o.id === selectedOptionId)
              ?.label ||
            "Saved answer",
        ]);
        return;
      }

      // Next question block received
      if (res.status === "NEEDS_MORE_INFORMATION" && res.next_block) {
        setActiveBlock(res.next_block);
        setStepNumber(res.next_block.sequence_number);
        setSelectedOptionId(null);
        setFreeText("");
        return;
      }

      // All questions completed -> trigger AI Consensus Analysis
      if (res.status === "READY_FOR_ANALYSIS" && encounterId) {
        setReady(true);
        await startAnalysis(token, encounterId);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to record response",
      );
    } finally {
      requestBusy.current = false;
      setLoading(false);
    }
  }

  if (restoring)
    return (
      <main className={`${checkinTypography} min-h-dvh bg-canvas p-6`}>
        <p role="status">Restoring check-in…</p>
      </main>
    );
  if (isEmergency && safetyAlert)
    return <CheckinSafety alert={safetyAlert} answers={emergencyTriggers} />;

  // --- Initial Concern Prompt (Before Questioning Starts) ---
  if (!started) {
    return (
      <main
        className={`${checkinTypography} min-h-dvh bg-clear-canvas px-6 py-6 md:py-10`}
      >
        <div className="mx-auto max-w-[345px]">
          {/* Header */}
          <div className="flex items-center justify-between">
            <Link
              href="/app/patient"
              className="font-sans text-2xl text-ink hover:opacity-80"
            >
              ←
            </Link>
            <div className="flex items-center gap-2">
              <div className="grid size-[38px] place-items-center rounded-[12px] bg-clear-action font-sans text-lg font-bold text-white">
                C
              </div>
              <span className="font-sans text-2xl font-semibold text-ink">
                ClinixAI
              </span>
            </div>
            <Link
              href="/app/patient"
              className="font-sans text-xs font-semibold text-clear-action hover:underline"
            >
              Exit
            </Link>
          </div>

          {/* AI Chip */}
          <div className="mt-8 flex items-center justify-between">
            <span className="inline-block rounded-full border border-clear-divider/60 bg-canvas px-3 py-1 font-sans text-xs font-semibold tracking-wider text-ink uppercase">
              ◆ AI-assisted check-in
            </span>
          </div>

          <h1 className="mt-6 font-sans text-[28px] font-bold leading-tight text-ink">
            What symptoms are you experiencing?
          </h1>
          <p className="mt-2 font-sans text-xs text-graphite">
            Describe your current concern. We will guide you through tailored
            follow-up questions to prepare your record.
          </p>

          <form onSubmit={handleStartCheckin} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="chief-concern-input"
                className="clinix-label text-graphite"
              >
                Current symptom or concern
              </label>
              <textarea
                id="chief-concern-input"
                rows={4}
                readOnly={Boolean(sessionId)}
                value={chiefConcern}
                onChange={(e) => setChiefConcern(e.target.value)}
                placeholder="e.g. Dry cough for the past few days with slight throat irritation..."
                className="clinix-field w-full resize-none p-3 font-sans text-sm"
                required
              />
            </div>

            {errorMsg && (
              <p
                role="alert"
                className="rounded-lg bg-critical/10 p-2 font-sans text-xs text-critical"
              >
                {errorMsg}
              </p>
            )}

            <p className="font-sans text-xs text-graphite/80">
              AI assistance structures this check-in; it does not provide a
              diagnosis.
            </p>

            <button
              type="submit"
              disabled={loading || !chiefConcern.trim()}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-clear-action px-6 py-3 font-sans text-sm font-semibold tracking-wide text-white shadow transition-transform active:translate-y-px disabled:opacity-50"
            >
              <span>
                {loading
                  ? "Starting..."
                  : sessionId
                    ? "RESUME CHECK-IN"
                    : "START ASSESSMENT"}
              </span>
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-full bg-surface text-sm font-bold text-ink"
              >
                →
              </span>
            </button>
          </form>
        </div>
      </main>
    );
  }

  // --- Render Screen 6: Adaptive Question Block (Figma Node 15:2) ---
  return (
    <main
      className={`${checkinTypography} min-h-dvh bg-clear-canvas px-6 py-6 md:py-10`}
    >
      <div className="mx-auto max-w-[345px]">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            aria-label="Previous question or concern"
            disabled={loading}
            className="font-sans text-2xl text-ink hover:opacity-80"
          >
            ←
          </button>
          <div className="flex items-center gap-2">
            <div className="grid size-[38px] place-items-center rounded-[12px] bg-clear-action font-sans text-lg font-bold text-white">
              C
            </div>
            <span className="font-sans text-2xl font-semibold text-ink">
              ClinixAI
            </span>
          </div>
          <Link
            href="/app/patient"
            className="font-sans text-xs font-semibold text-clear-action hover:underline"
          >
            Exit
          </Link>
        </div>

        {/* Subheader: Chip & Step */}
        <div className="mt-7 flex items-center justify-between">
          <span className="rounded-full border border-clear-divider/60 bg-canvas px-3 py-1 font-sans text-xs font-semibold tracking-wider text-ink uppercase">
            ◆ AI-assisted check-in
          </span>
          <span className="font-sans tabular-nums text-xs font-semibold tracking-wider text-graphite uppercase">
            STEP {stepNumber} OF {totalSteps}
          </span>
        </div>

        {/* Segmented Progress Bar */}
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-[7px] flex-1 rounded-[4px] transition-colors ${
                i < stepNumber ? "bg-clear-action" : "bg-clear-divider"
              }`}
            />
          ))}
        </div>

        {/* Current Symptom Eyebrow */}
        <p className="mt-6 font-sans text-xs font-semibold tracking-widest text-graphite uppercase">
          CURRENT SYMPTOM · {chiefConcern.slice(0, 30).toUpperCase()}
        </p>

        {/* Title */}
        <h1 className="mt-2 font-sans text-[30px] font-bold leading-tight text-ink md:text-[30px]">
          {activeBlock?.title ?? "How long have you had this symptom?"}
        </h1>

        {/* Subtitle */}
        <p className="mt-2 font-sans text-xs leading-relaxed text-graphite">
          {activeBlock?.help_text ??
            "Choose the closest answer. Your next question may change based on what you select."}
        </p>

        {/* "Why This Question" Callout Tray */}
        <div className="mt-5 rounded-[20px] border border-clear-divider bg-clear-canvas p-4 ring-[5px] ring-clear-divider/70">
          <div className="flex items-center justify-between">
            <span className="font-sans text-xs font-semibold tracking-wider text-ink uppercase">
              Why this question
            </span>
            <button
              type="button"
              aria-expanded={showBasis}
              onClick={() => setShowBasis(!showBasis)}
              className="font-sans text-xs font-semibold text-clear-action hover:underline"
            >
              {showBasis ? "Hide basis" : "View basis"}
            </button>
          </div>
          <p className="mt-1.5 font-sans text-xs text-graphite">
            Based on &ldquo;{chiefConcern}&rdquo; and your earlier answers.
          </p>
          {showBasis && (
            <p className="mt-2 border-t border-hairline pt-2 font-sans text-xs text-graphite/90">
              This question is part of the configured check-in sequence. Your
              saved concern is “{chiefConcern}”.{" "}
              {
                history.filter(
                  (h) => h.answer && h.block.sequence_number < stepNumber,
                ).length
              }{" "}
              earlier answers have been saved.
            </p>
          )}
        </div>

        {/* Options Section */}
        <div className="mt-6">
          <p className="font-sans text-xs font-semibold tracking-wider text-graphite uppercase">
            SELECT ONE
          </p>

          <div className="mt-3 space-y-2.5">
            {activeBlock?.options?.map((opt) => {
              const isSelected = selectedOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={loading || ready}
                  onClick={() => {
                    setSelectedOptionId(opt.id);
                    if (opt.id !== "other") setFreeText("");
                  }}
                  className={`flex w-full items-center gap-3 rounded-[18px] border p-4 text-left transition-all ${
                    isSelected
                      ? "border-ink bg-clear-canvas font-medium text-ink"
                      : "border-clear-divider bg-clear-canvas text-ink/90 hover:bg-surface"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`text-lg leading-none ${
                      isSelected ? "text-ink font-bold" : "text-clear-action"
                    }`}
                  >
                    {isSelected ? "●" : "○"}
                  </span>
                  <span className="font-sans text-sm">{opt.label}</span>
                </button>
              );
            })}

            {/* Custom / Free Text Fallback */}
            {activeBlock?.allow_free_text && selectedOptionId === "other" && (
              <div className="mt-3 rounded-[18px] border border-ink bg-surface p-3">
                <label
                  htmlFor="other-details"
                  className="clinix-label text-graphite"
                >
                  Describe in your own words
                </label>
                <textarea
                  id="other-details"
                  rows={3}
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="Tell us what you are feeling..."
                  className="clinix-field mt-1 w-full resize-none p-2 font-sans text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-critical/10 p-2 font-sans text-xs text-critical"
          >
            {errorMsg}
          </p>
        )}

        {/* Disclaimer */}
        <p className="mt-5 font-sans text-xs leading-relaxed text-graphite/80">
          AI assistance structures this check-in; it does not provide a
          diagnosis.
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={loading}
            className="flex min-h-[48px] items-center justify-center rounded-[18px] border border-ink px-6 font-sans text-xs font-semibold tracking-wider text-ink transition-colors hover:bg-ink/5"
          >
            BACK
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[18px] bg-clear-action px-6 font-sans text-xs font-semibold tracking-wider text-white shadow transition-transform active:translate-y-px disabled:opacity-50"
          >
            <span>
              {loading ? "SAVING..." : ready ? "START ANALYSIS" : "CONTINUE"}
            </span>
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-full bg-surface text-sm font-bold text-ink"
            >
              →
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
