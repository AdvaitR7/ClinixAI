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
  { label: "Vault", href: "/app/patient", disabled: true },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient", disabled: true },
];

const PACKET_OPTIONS = [
  "Recent reports",
  "Lab trends",
  "Medication list",
  "Encounter history",
] as const;

function slotTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Page 14 — Appointment booking + packet builder (SCREEN_CATALOG §7). */
export default function BookPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const doctors = useApiData<DoctorOption[]>("/doctors");

  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [packet, setPacket] = useState<string[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    }
  }

  const doctorName =
    doctors.status === "ready"
      ? doctors.data.find((d) => d.doctor_id === doctorId)?.name
      : undefined;

  return (
    <WorkspaceShell workspace="Patient" title="Book appointment" nav={nav}>
      <div className="space-y-6">
        <section className="space-y-4">
          <div>
            <label htmlFor="doctor" className="font-sans text-sm font-medium">
              Doctor
            </label>
            <select
              id="doctor"
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value);
                setSlots(null);
                setSlot(null);
              }}
              className="mt-1 h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper"
            >
              <option value="">Select a doctor</option>
              {doctors.status === "ready" &&
                doctors.data.map((d) => (
                  <option key={d.doctor_id} value={d.doctor_id}>
                    {d.name}
                    {d.speciality ? ` — ${d.speciality}` : ""}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date" className="font-sans text-sm font-medium">
                Date
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
                className="mt-1 h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={loadSlots}
                disabled={!doctorId || !date || slotsLoading}
                className="h-11 w-full rounded-full bg-botanical px-4 font-sans text-sm font-semibold text-surface transition-transform active:translate-y-px disabled:opacity-60"
              >
                {slotsLoading ? "Checking…" : "Check times"}
              </button>
            </div>
          </div>
        </section>

        {slots && (
          <section>
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
              Available times
            </p>
            {slots.length === 0 ? (
              <p className="mt-2 font-sans text-sm text-graphite">No available slots for this day.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSlot(s)}
                    className={`rounded-xl border px-3 py-2 font-mono text-sm transition-transform active:translate-y-px ${
                      slot?.start === s.start
                        ? "border-copper bg-copper/10 text-botanical"
                        : "border-hairline bg-surface text-ink"
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
            <section>
              <label htmlFor="reason" className="font-sans text-sm font-medium">
                Reason for visit <span className="text-graphite">(optional)</span>
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper"
              />
            </section>

            <section className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                Share with your doctor
              </p>
              <p className="mt-1 font-sans text-sm text-graphite">
                Choose the health context to include in this visit&apos;s packet.
              </p>
              <ul className="mt-3 space-y-2">
                {PACKET_OPTIONS.map((opt) => (
                  <li key={opt}>
                    <label className="flex items-center gap-2 font-sans text-sm">
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
                        className="h-4 w-4 accent-[#12352c]"
                      />
                      {opt}
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                What will be shared
              </p>
              <dl className="mt-3 space-y-2 font-sans text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Recipient</dt>
                  <dd className="font-semibold">{doctorName ?? "Selected doctor"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Purpose</dt>
                  <dd>Consultation</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Scope</dt>
                  <dd>{packet.length ? packet.join(", ") : "Basic visit details only"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Expiry</dt>
                  <dd>End of consultation</dd>
                </div>
              </dl>
              <p className="mt-3 font-sans text-xs text-graphite">
                Formal consent scopes arrive with the privacy ledger. This booking shares your
                record with the doctor you are seeing.
              </p>
            </section>

            <section className="rounded-2xl border border-hairline bg-surface p-4">
              <p className="font-sans text-sm text-graphite">
                Payment is collected at the clinic. The doctor tracks payment status manually.
              </p>
            </section>

            {error && (
              <p role="alert" className="font-sans text-sm font-medium text-critical">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={book}
              className="w-full rounded-full bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical transition-transform active:translate-y-px"
            >
              Confirm booking
            </button>
          </>
        )}

        {doctors.status === "loading" && <Skeleton className="h-20 rounded-2xl" />}
      </div>
    </WorkspaceShell>
  );
}
