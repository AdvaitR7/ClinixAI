"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AvailabilitySlot, DoctorOption } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient", active: true },
  { label: "Timeline", href: "/app/patient", disabled: true },
  { label: "Vault", href: "/app/patient", disabled: true },
  { label: "Visits", href: "/app/patient", disabled: true },
  { label: "Care", href: "/app/patient", disabled: true },
];

function slotTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Interim booking flow — superseded by Page 14 in Phase 3. */
export default function BookPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const doctors = useApiData<DoctorOption[]>("/doctors");

  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSlots() {
    if (!doctorId || !date) return;
    setError(null);
    setSlotsLoading(true);
    setSlots(null);
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

  async function book(slot: AvailabilitySlot) {
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
      router.replace("/app/patient");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    }
  }

  return (
    <WorkspaceShell workspace="Patient" title="Book doctor" nav={nav}>
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
              <p className="mt-2 font-sans text-sm text-graphite">
                No available slots for this day.
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => book(s)}
                    className="rounded-xl border border-hairline bg-surface px-3 py-2 font-mono text-sm text-ink transition-transform active:translate-y-px"
                  >
                    {slotTime(s.start)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <div>
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
        </div>

        {error && (
          <p role="alert" className="font-sans text-sm font-medium text-critical">
            {error}
          </p>
        )}
      </div>
    </WorkspaceShell>
  );
}
