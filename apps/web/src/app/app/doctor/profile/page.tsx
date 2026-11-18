"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiData } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { useApiWrite } from "@/lib/staff";
import { doctorNav } from "@/lib/workspace-nav";

const nav = doctorNav();
const card = "rounded-[18px] border border-clear-divider bg-clear-surface p-4";
const label = "text-xs uppercase text-clear-action";
const field = "min-h-11 w-full rounded-xl border border-clear-divider bg-clear-surface px-3 text-sm";

type Service = { name: string; mode: "IN_CLINIC" | "ONLINE"; fee_inr: number; duration_minutes: number };
type Profile = {
  locked: { display_name: string; registration_number: string; registration_authority: string; qualification: string | null; speciality: string | null; verification_status: string };
  bio: string | null;
  languages: string[];
  visit_duration_minutes: number | null;
  services: Service[];
  accepting_appointments: boolean;
  directory_visible: boolean;
};

/** Page 27 — doctor profile and consultation services. Verified fields are locked. */
export default function DoctorProfilePage() {
  const profile = useApiData<Profile>("/doctors/self/profile");
  return (
    <WorkspaceShell workspace="Doctor" title="Doctor profile" nav={nav} focused hideHeading>
      <div>
        <p className={label}>Doctor profile · consultation services</p>
        <h1 className="mt-2 text-[28px] leading-tight">Profile & services</h1>
      </div>
      {profile.status === "loading" && <p role="status" className="text-sm">Loading profile…</p>}
      {profile.status === "error" && <p role="alert" className="text-sm">{profile.error}</p>}
      {profile.status === "ready" && <ProfileForm initial={profile.data} />}
    </WorkspaceShell>
  );
}

/** Editable form seeded once from the loaded profile. */
function ProfileForm({ initial }: { initial: Profile }) {
  const write = useApiWrite();
  const [draft, setDraft] = useState<Profile>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  /** Saves editable fields only; the API rejects locked ones. */
  async function save() {
    setStatus("saving");
    try {
      await write("/doctors/self/profile", "PUT", {
        bio: draft.bio ?? "",
        languages: draft.languages,
        visit_duration_minutes: draft.visit_duration_minutes ?? undefined,
        services: draft.services,
        accepting_appointments: draft.accepting_appointments,
        directory_visible: draft.directory_visible,
      });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
        <>
          <section className={card}>
            <p className={label}>Verified · locked</p>
            <p className="mt-2 text-sm font-semibold">{draft.locked.display_name}</p>
            <p className="text-xs text-clear-secondary">{draft.locked.qualification ?? "—"} · {draft.locked.speciality ?? "—"}</p>
            <p className="text-xs text-clear-secondary">Reg. {draft.locked.registration_number} · {draft.locked.registration_authority}</p>
            <p className="mt-1 text-xs text-clear-action">{draft.locked.verification_status}. Changes require re-verification.</p>
          </section>
          <section className={card}>
            <label className="text-xs">About<textarea value={draft.bio ?? ""} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} rows={3} maxLength={1000} className={`${field} mt-1 py-2`} /></label>
            <label className="mt-3 block text-xs">Languages (comma separated)<input value={draft.languages.join(", ")} onChange={(e) => setDraft({ ...draft, languages: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className={`${field} mt-1`} /></label>
            <label className="mt-3 block text-xs">Visit duration (minutes)<input type="number" value={draft.visit_duration_minutes ?? ""} onChange={(e) => setDraft({ ...draft, visit_duration_minutes: e.target.value ? Number(e.target.value) : null })} className={`${field} mt-1`} /></label>
          </section>
          <section aria-labelledby="svc">
            <p className={label}>Consultation services</p>
            <h2 id="svc" className="sr-only">Services</h2>
            <ul className="mt-2 space-y-3">
              {draft.services.map((s, i) => (
                <li key={i} className={card}>
                  <input aria-label={`Service ${i + 1} name`} value={s.name} onChange={(e) => setDraft({ ...draft, services: draft.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={field} />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input aria-label={`Service ${i + 1} fee`} type="number" value={s.fee_inr} onChange={(e) => setDraft({ ...draft, services: draft.services.map((x, j) => (j === i ? { ...x, fee_inr: Number(e.target.value) } : x)) })} className={field} />
                    <input aria-label={`Service ${i + 1} duration`} type="number" value={s.duration_minutes} onChange={(e) => setDraft({ ...draft, services: draft.services.map((x, j) => (j === i ? { ...x, duration_minutes: Number(e.target.value) } : x)) })} className={field} />
                  </div>
                  <button type="button" onClick={() => setDraft({ ...draft, services: draft.services.filter((_, j) => j !== i) })} className="mt-2 min-h-11 text-xs text-critical">Remove</button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setDraft({ ...draft, services: [...draft.services, { name: "In-clinic visit", mode: "IN_CLINIC", fee_inr: 600, duration_minutes: 20 }] })} className="mt-3 min-h-11 w-full rounded-2xl border border-clear-divider px-4 text-sm">+ Add service</button>
          </section>
          <section className={card}>
            <label className="flex min-h-11 items-center justify-between text-sm">Accepting appointments<input type="checkbox" checked={draft.accepting_appointments} onChange={(e) => setDraft({ ...draft, accepting_appointments: e.target.checked })} /></label>
            <label className="flex min-h-11 items-center justify-between text-sm">Visible in directory<input type="checkbox" checked={draft.directory_visible} onChange={(e) => setDraft({ ...draft, directory_visible: e.target.checked })} /></label>
            <Link href="/app/doctor/schedule" className="mt-1 block min-h-11 text-xs text-clear-info">Edit availability →</Link>
          </section>
          <button type="button" disabled={status === "saving"} onClick={() => void save()} className="min-h-12 w-full rounded-2xl bg-clear-action px-4 text-sm font-semibold text-white">Save profile</button>
          {status === "saved" && <p role="status" className="text-xs text-clear-action">Saved.</p>}
          {status === "error" && <p role="alert" className="text-xs text-critical">Could not save. Nothing changed.</p>}
        </>
  );
}
