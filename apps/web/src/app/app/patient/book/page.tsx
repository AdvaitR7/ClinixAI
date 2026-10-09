"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AvailabilitySlot, DoctorOption } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient", disabled: true },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/medications" },
];

const PACKET_OPTIONS = [
  "Recent reports & lab observations",
  "Current active medications",
  "Past consultation notes",
  "Recent health timeline",
] as const;

function slotTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Page 14 — Appointment booking + packet builder & review (Figma 40:2 & 42:113). */
export default function BookPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const doctors = useApiData<DoctorOption[]>("/doctors");

  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [packet, setPacket] = useState<string[]>(["Recent reports & lab observations", "Current active medications"]);
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadSlots() {
    if (!doctorId || !date) return;
    setError(null);
    setSlotsLoading(true);
    setSlots(null);
    setSlot(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<{ slots: AvailabilitySlot[] }>(
        token,
        `/doctors/${doctorId}/availability?from=${date}&to=${date}`,
      );
      setSlots(res.slots);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load availability");
    } finally {
      setSlotsLoading(false);
    }
  }

  async function book() {
    if (!slot) return;
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, "/patients/self/appointments", {
        method: "POST",
        body: JSON.stringify({
          doctor_id: doctorId,
          appointment_type: "IN_PERSON",
          scheduled_start: slot.start,
          reason: reason || null,
        }),
      });
      router.replace("/app/patient/appointments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
      setSubmitting(false);
    }
  }

  const selectedDoctor =
    doctors.status === "ready"
      ? doctors.data.find((d) => d.doctor_id === doctorId)
      : undefined;

  return (
    <WorkspaceShell workspace="Patient" title="Book appointment" nav={nav}>
      {doctors.status === "loading" && <Skeleton className="h-28 rounded-3xl" />}

      {doctors.status === "ready" && !reviewing && (
        <div className="space-y-6">
          <section className="clinix-card p-5">
            <p className="clinix-label text-botanical">Step 1 · Schedule visit</p>
            <h2 className="mt-1 font-sans text-xl font-bold text-ink">Choose doctor & time</h2>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="doctor" className="font-sans text-xs font-semibold text-graphite">
                  Select doctor *
                </label>
                <select
                  id="doctor"
                  value={doctorId}
                  onChange={(e) => {
                    setDoctorId(e.target.value);
                    setSlots(null);
                    setSlot(null);
                  }}
                  className="clinix-field mt-1 font-sans text-sm font-medium"
                >
                  <option value="">Choose a physician</option>
                  {doctors.data.map((d) => (
                    <option key={d.doctor_id} value={d.doctor_id}>
                      Dr. {d.name} {d.speciality ? `(${d.speciality})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="date" className="font-sans text-xs font-semibold text-graphite">
                    Date *
                  </label>
                  <input
                    id="date"
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setSlots(null);
                      setSlot(null);
                    }}
                    className="clinix-field mt-1 font-sans text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={loadSlots}
                    disabled={!doctorId || !date || slotsLoading}
                    className="min-h-[50px] w-full rounded-2xl bg-botanical px-4 font-sans text-xs font-semibold uppercase tracking-wider text-surface transition-transform active:translate-y-px disabled:opacity-60"
                  >
                    {slotsLoading ? "Checking…" : "Find slots"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {slots && (
            <section className="clinix-card p-5">
              <p className="clinix-label text-botanical">Available slots</p>
              {slots.length === 0 ? (
                <p className="mt-2 font-sans text-xs text-graphite">No available slots for this day. Try another date.</p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={`min-h-11 rounded-xl border px-2 py-2 font-mono text-xs font-semibold transition-transform active:translate-y-px ${
                        slot?.start === s.start
                          ? "border-botanical bg-botanical text-surface shadow-sm"
                          : "border-sage bg-surface text-ink hover:border-botanical"
                      }`}
                    >
                      {slotTime(s.start)}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {slot && (
            <>
              <section className="clinix-card p-5">
                <label htmlFor="reason" className="clinix-label text-botanical">
                  Reason for visit <span className="text-graphite font-normal">(optional)</span>
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe your symptoms or follow-up reason..."
                  rows={3}
                  className="clinix-field mt-2 font-sans text-sm"
                />
              </section>

              {/* Node 40:2 Scoped consultation packet */}
              <section className="clinix-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="clinix-label text-botanical">Consultation packet</p>
                    <h3 className="mt-1 font-sans text-base font-bold text-ink">Included health context</h3>
                  </div>
                  <span className="rounded-full border border-sage px-2 py-0.5 font-sans text-[10px] font-bold uppercase text-botanical">
                    Scoped preview
                  </span>
                </div>
                <p className="mt-1 font-sans text-xs leading-5 text-graphite">
                  Select what record excerpts are shared for this visit.
                </p>
                <ul className="mt-4 space-y-2.5">
                  {PACKET_OPTIONS.map((opt) => (
                    <li key={opt}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-hairline bg-canvas p-3 font-sans text-xs font-semibold text-ink">
                        <input
                          type="checkbox"
                          checked={packet.includes(opt)}
                          onChange={(e) =>
                            setPacket((prev) =>
                              e.target.checked
                                ? [...prev, opt]
                                : prev.filter((p) => p !== opt),
                            )
                          }
                          className="size-4 accent-[#12352c]"
                        />
                        {opt}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>

              <button
                type="button"
                onClick={() => setReviewing(true)}
                className="min-h-[54px] w-full rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-bold uppercase tracking-wider text-ink transition-transform active:translate-y-px"
              >
                Review booking details →
              </button>
            </>
          )}
        </div>
      )}

      {/* Node 42:113 — Review Consultation Booking */}
      {reviewing && selectedDoctor && slot && (
        <div className="space-y-6">
          <section className="clinix-card p-5">
            <span className="rounded-full border border-sage px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-botanical">
              Review before sharing
            </span>
            <h2 className="mt-2 font-sans text-2xl font-bold text-ink">Visit summary</h2>

            <dl className="mt-4 space-y-3 font-sans text-sm">
              <div className="flex justify-between border-b border-hairline pb-2">
                <dt className="text-graphite">Doctor</dt>
                <dd className="font-semibold text-ink">Dr. {selectedDoctor.name}</dd>
              </div>
              <div className="flex justify-between border-b border-hairline pb-2">
                <dt className="text-graphite">Speciality</dt>
                <dd className="text-ink">{selectedDoctor.speciality || "General Physician"}</dd>
              </div>
              <div className="flex justify-between border-b border-hairline pb-2">
                <dt className="text-graphite">Date & time</dt>
                <dd className="font-mono text-ink">
                  {new Date(slot.start).toLocaleDateString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })} · {slotTime(slot.start)}
                </dd>
              </div>
              <div className="flex justify-between border-b border-hairline pb-2">
                <dt className="text-graphite">Type</dt>
                <dd className="text-ink">In person consultation</dd>
              </div>
              {reason && (
                <div className="flex justify-between">
                  <dt className="text-graphite">Reason</dt>
                  <dd className="text-ink">{reason}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="clinix-card p-5">
            <p className="clinix-label text-botanical">Sharing receipt (preview)</p>
            <dl className="mt-3 space-y-2 font-sans text-xs text-graphite">
              <div className="flex justify-between"><dt>Recipient:</dt><dd className="font-semibold text-ink">Dr. {selectedDoctor.name}</dd></div>
              <div className="flex justify-between"><dt>Purpose:</dt><dd className="text-ink">Clinical consultation</dd></div>
              <div className="flex justify-between"><dt>Scope:</dt><dd className="text-ink">{packet.length ? `${packet.length} modules selected` : "Basic details only"}</dd></div>
              <div className="flex justify-between"><dt>Expiry:</dt><dd className="text-ink">End of encounter</dd></div>
            </dl>
            <p className="mt-3 text-[11px] text-graphite">
              Payment is collected at the clinic.
            </p>
          </section>

          {error && <p role="alert" className="font-sans text-sm font-medium text-critical">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setReviewing(false)}
              disabled={submitting}
              className="min-h-[52px] flex-1 rounded-[1.25rem] border border-sage bg-surface font-sans text-sm font-semibold text-graphite"
            >
              Back to edit
            </button>
            <button
              type="button"
              onClick={book}
              disabled={submitting}
              className="min-h-[52px] flex-1 rounded-[1.25rem] bg-copper font-sans text-sm font-bold uppercase tracking-wider text-ink transition-transform active:translate-y-px disabled:opacity-60"
            >
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
