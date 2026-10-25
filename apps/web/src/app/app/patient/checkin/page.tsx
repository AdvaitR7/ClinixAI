"use client";

import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  InteractionBlockView,
  InteractionResponseResult,
  SafetyAlert,
} from "@clinix/schemas";
import { fetchApi } from "@/lib/api";

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
  const [activeBlock, setActiveBlock] = useState<InteractionBlockView | null>(null);
  const [stepNumber, setStepNumber] = useState(1);
  const totalSteps = 7;

  // Answer selection
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [showBasis, setShowBasis] = useState(false);

  // Emergency interrupt state (Screen 6a)
  const [isEmergency, setIsEmergency] = useState(false);
  const [safetyAlert, setSafetyAlert] = useState<SafetyAlert | null>(null);
  const [emergencyTriggers, setEmergencyTriggers] = useState<string[]>([]);

  // 1. Start check-in: creates encounter and calls /interaction/start
  async function handleStartCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!chiefConcern.trim()) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");

      // Create encounter first
      const encRes = await fetchApi<{ encounter_id: string }>(
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
      }>(token, `/encounters/${newEncId}/interaction/start`, {
        method: "POST",
        body: JSON.stringify({ chief_concern: chiefConcern.trim() }),
      });

      if (startRes.status === "SAFETY_ESCALATION" && startRes.safety_alert) {
        setIsEmergency(true);
        setSafetyAlert(startRes.safety_alert);
        setEmergencyTriggers([chiefConcern]);
        return;
      }

      setSessionId(startRes.interaction_session_id);
      setActiveBlock(startRes.next_block ?? null);
      setStepNumber(1);
      setStarted(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to start check-in");
    } finally {
      setLoading(false);
    }
  }

  // 2. Submit response to active block
  async function handleContinue() {
    if (!sessionId || !activeBlock) return;
    if (!selectedOptionId && !freeText.trim()) {
      setErrorMsg("Please select an answer or describe your symptoms.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");

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

      // Red-flag Safety Interrupt triggered (Screen 6a)
      if (res.status === "SAFETY_ESCALATION" && res.safety_alert) {
        setIsEmergency(true);
        setSafetyAlert(res.safety_alert);
        setEmergencyTriggers(
          freeText ? [freeText] : [selectedOptionId ?? chiefConcern],
        );
        return;
      }

      // Next question block received
      if (res.status === "NEEDS_MORE_INFORMATION" && res.next_block) {
        setActiveBlock(res.next_block);
        setStepNumber((s) => s + 1);
        setSelectedOptionId(null);
        setFreeText("");
        return;
      }

      // All questions completed -> trigger AI Consensus Analysis
      if (res.status === "READY_FOR_ANALYSIS" && encounterId) {
        const aiRes = await fetchApi<{ ai_session_id: string; status: string }>(
          token,
          `/encounters/${encounterId}/ai-analysis`,
          { method: "POST" },
        );
        router.push(`/app/patient/checkin/result/${aiRes.ai_session_id}`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to record response");
    } finally {
      setLoading(false);
    }
  }

  // --- Render Screen 6a: Red-flag Safety Interrupt (Figma Node 15:3) ---
  if (isEmergency) {
    return (
      <main className="min-h-dvh bg-surface px-6 py-6 md:py-10">
        <div className="mx-auto max-w-[393px]">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="grid size-[38px] place-items-center rounded-[12px] bg-botanical font-sans text-lg font-bold text-surface">
              C
            </div>
            <span className="font-sans text-2xl font-semibold text-botanical">
              ClinixAI
            </span>
          </div>

          {/* Safety Check Badge */}
          <div className="mt-8">
            <span className="inline-block rounded-full border border-critical px-3 py-1 font-sans text-[10px] font-semibold tracking-wider text-critical uppercase">
              Safety check
            </span>
          </div>

          {/* Alert Icon & Heading */}
          <div className="mt-5 grid size-[54px] place-items-center rounded-[18px] bg-critical text-2xl font-bold text-surface">
            !
          </div>

          <h1 className="mt-5 font-sans text-[30px] font-bold leading-tight text-ink">
            Get urgent medical help now
          </h1>

          <p className="mt-3 font-sans text-sm leading-relaxed text-graphite">
            Your answers include signs that need urgent in-person assessment. This
            check-in is paused.
          </p>

          {/* Why this appeared Card */}
          <div className="mt-6 rounded-[22px] border border-critical bg-critical/5 p-5">
            <p className="font-sans text-[9px] font-semibold tracking-wider text-critical uppercase">
              Why this appeared
            </p>
            <p className="mt-2 font-sans text-xs text-graphite">
              Based on your selected answers:
            </p>
            <ul className="mt-2 space-y-1">
              {emergencyTriggers.map((t, i) => (
                <li key={i} className="font-sans text-xs font-medium text-ink">
                  • {t}
                </li>
              ))}
              {safetyAlert?.message && (
                <li className="mt-1 font-sans text-xs font-semibold text-critical">
                  • {safetyAlert.message}
                </li>
              )}
            </ul>
          </div>

          {/* Action CTAs */}
          <div className="mt-8 space-y-3">
            <a
              href={`tel:${safetyAlert?.emergency_number?.split(" ")[0] || "112"}`}
              className="flex min-h-[58px] w-full items-center justify-center gap-3 rounded-[20px] bg-critical px-6 py-4 font-sans text-sm font-semibold tracking-wide text-surface shadow-md transition-transform active:translate-y-px"
            >
              <span>CALL EMERGENCY SERVICES</span>
              <span className="grid size-8 place-items-center rounded-full bg-surface text-base font-bold text-critical">
                →
              </span>
            </a>

            <a
              href="https://maps.google.com/?q=emergency+hospital+near+me"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[52px] w-full items-center justify-center rounded-[18px] border border-critical bg-surface px-6 py-3 font-sans text-xs font-semibold tracking-wide text-critical transition-colors hover:bg-critical/5"
            >
              FIND NEAREST EMERGENCY DEPARTMENT
            </a>
          </div>

          {/* Support Note */}
          <div className="mt-5 rounded-[16px] bg-canvas p-4">
            <p className="font-sans text-xs text-graphite">
              If possible, ask someone to stay with you while you get help.
            </p>
          </div>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => setIsEmergency(false)}
              className="font-sans text-xs font-semibold text-evidence underline hover:text-evidence/80"
            >
              Review the answers that triggered this alert
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- Initial Concern Prompt (Before Questioning Starts) ---
  if (!started) {
    return (
      <main className="min-h-dvh bg-canvas px-6 py-6 md:py-10">
        <div className="mx-auto max-w-[393px]">
          {/* Header */}
          <div className="flex items-center justify-between">
            <Link
              href="/app/patient"
              className="font-sans text-2xl text-botanical hover:opacity-80"
            >
              ←
            </Link>
            <div className="flex items-center gap-2">
              <div className="grid size-[38px] place-items-center rounded-[12px] bg-botanical font-sans text-lg font-bold text-surface">
                C
              </div>
              <span className="font-sans text-2xl font-semibold text-ink">
                ClinixAI
              </span>
            </div>
            <Link
              href="/app/patient"
              className="font-sans text-xs font-semibold text-copper hover:underline"
            >
              Exit
            </Link>
          </div>

          {/* AI Chip */}
          <div className="mt-8 flex items-center justify-between">
            <span className="inline-block rounded-full border border-copper/60 bg-canvas px-3 py-1 font-sans text-[9px] font-semibold tracking-wider text-botanical uppercase">
              ◆ AI-assisted check-in
            </span>
          </div>

          <h1 className="mt-6 font-sans text-[28px] font-bold leading-tight text-ink">
            What symptoms are you experiencing?
          </h1>
          <p className="mt-2 font-sans text-xs text-graphite">
            Describe your current concern. We will guide you through tailored follow-up
            questions to prepare your record.
          </p>

          <form onSubmit={handleStartCheckin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="chief-concern-input" className="clinix-label text-graphite">
                Current symptom or concern
              </label>
              <textarea
                id="chief-concern-input"
                rows={4}
                value={chiefConcern}
                onChange={(e) => setChiefConcern(e.target.value)}
                placeholder="e.g. Dry cough for the past few days with slight throat irritation..."
                className="clinix-field w-full resize-none p-3 font-sans text-sm"
                required
              />
            </div>

            {errorMsg && (
              <p className="rounded-lg bg-critical/10 p-2 font-sans text-xs text-critical">
                {errorMsg}
              </p>
            )}

            <p className="font-sans text-[10px] text-graphite/80">
              AI assistance structures this check-in; it does not provide a diagnosis.
            </p>

            <button
              type="submit"
              disabled={loading || !chiefConcern.trim()}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-botanical px-6 py-3 font-sans text-sm font-semibold tracking-wide text-surface shadow transition-transform active:translate-y-px disabled:opacity-50"
            >
              <span>{loading ? "Starting..." : "START ASSESSMENT"}</span>
              <span className="grid size-7 place-items-center rounded-full bg-surface text-sm font-bold text-botanical">
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
    <main className="min-h-dvh bg-canvas px-6 py-6 md:py-10">
      <div className="mx-auto max-w-[393px]">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (stepNumber > 1) setStepNumber((s) => s - 1);
              else setStarted(false);
            }}
            className="font-sans text-2xl text-botanical hover:opacity-80"
          >
            ←
          </button>
          <div className="flex items-center gap-2">
            <div className="grid size-[38px] place-items-center rounded-[12px] bg-botanical font-sans text-lg font-bold text-surface">
              C
            </div>
            <span className="font-sans text-2xl font-semibold text-ink">
              ClinixAI
            </span>
          </div>
          <Link
            href="/app/patient"
            className="font-sans text-xs font-semibold text-copper hover:underline"
          >
            Exit
          </Link>
        </div>

        {/* Subheader: Chip & Step */}
        <div className="mt-7 flex items-center justify-between">
          <span className="rounded-full border border-copper/60 bg-canvas px-3 py-1 font-sans text-[9px] font-semibold tracking-wider text-botanical uppercase">
            ◆ AI-assisted check-in
          </span>
          <span className="font-mono text-[10px] font-semibold tracking-wider text-graphite uppercase">
            STEP {stepNumber} OF {totalSteps}
          </span>
        </div>

        {/* Segmented Progress Bar */}
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-[7px] flex-1 rounded-[4px] transition-colors ${
                i < stepNumber ? "bg-botanical" : "bg-copper/30"
              }`}
            />
          ))}
        </div>

        {/* Current Symptom Eyebrow */}
        <p className="mt-6 font-sans text-[10px] font-semibold tracking-widest text-graphite uppercase">
          CURRENT SYMPTOM · {chiefConcern.slice(0, 30).toUpperCase()}
        </p>

        {/* Title */}
        <h1 className="mt-2 font-sans text-[26px] font-bold leading-tight text-ink md:text-[29px]">
          {activeBlock?.title ?? "How long have you had this symptom?"}
        </h1>

        {/* Subtitle */}
        <p className="mt-2 font-sans text-xs leading-relaxed text-graphite">
          {activeBlock?.help_text ??
            "Choose the closest answer. Your next question may change based on what you select."}
        </p>

        {/* "Why This Question" Callout Tray */}
        <div className="mt-5 rounded-[20px] border border-copper/40 bg-surface/70 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[9px] font-semibold tracking-wider text-botanical uppercase">
              Why this question
            </span>
            <button
              type="button"
              onClick={() => setShowBasis(!showBasis)}
              className="font-sans text-[10px] font-semibold text-copper hover:underline"
            >
              {showBasis ? "Hide basis" : "View basis"}
            </button>
          </div>
          <p className="mt-1.5 font-sans text-xs text-graphite">
            Based on &ldquo;{chiefConcern}&rdquo; and your earlier answers.
          </p>
          {showBasis && (
            <p className="mt-2 border-t border-hairline pt-2 font-sans text-[11px] text-graphite/90">
              Clinical protocols assess onset and timeline to distinguish acute episodes from
              chronic conditions.
            </p>
          )}
        </div>

        {/* Options Section */}
        <div className="mt-6">
          <p className="font-sans text-[10px] font-semibold tracking-wider text-graphite uppercase">
            SELECT ONE
          </p>

          <div className="mt-3 space-y-2.5">
            {activeBlock?.options?.map((opt) => {
              const isSelected = selectedOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSelectedOptionId(opt.id);
                    if (opt.id !== "other") setFreeText("");
                  }}
                  className={`flex w-full items-center gap-3 rounded-[18px] border p-4 text-left transition-all ${
                    isSelected
                      ? "border-botanical bg-surface font-semibold text-ink shadow-sm"
                      : "border-[#d8d0c4] bg-surface/60 text-ink/90 hover:bg-surface"
                  }`}
                >
                  <span
                    className={`text-lg leading-none ${
                      isSelected ? "text-botanical font-bold" : "text-copper"
                    }`}
                  >
                    {isSelected ? "●" : "○"}
                  </span>
                  <span className="font-sans text-sm">{opt.label}</span>
                </button>
              );
            })}

            {/* Custom / Free Text Fallback */}
            {selectedOptionId === "other" && (
              <div className="mt-3 rounded-[18px] border border-botanical bg-surface p-3">
                <label htmlFor="other-details" className="clinix-label text-graphite">
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
          <p className="mt-4 rounded-lg bg-critical/10 p-2 font-sans text-xs text-critical">
            {errorMsg}
          </p>
        )}

        {/* Disclaimer */}
        <p className="mt-5 font-sans text-[10px] leading-relaxed text-graphite/80">
          AI assistance structures this check-in; it does not provide a diagnosis.
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (stepNumber > 1) setStepNumber((s) => s - 1);
              else setStarted(false);
            }}
            className="flex min-h-[48px] items-center justify-center rounded-[18px] border border-botanical px-6 font-sans text-xs font-semibold tracking-wider text-botanical transition-colors hover:bg-botanical/5"
          >
            BACK
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[18px] bg-botanical px-6 font-sans text-xs font-semibold tracking-wider text-surface shadow transition-transform active:translate-y-px disabled:opacity-50"
          >
            <span>{loading ? "SAVING..." : "CONTINUE"}</span>
            <span className="grid size-7 place-items-center rounded-full bg-surface text-sm font-bold text-botanical">
              →
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
