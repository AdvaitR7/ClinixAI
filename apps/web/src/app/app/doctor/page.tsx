import { WorkspaceShell } from "@/components/workspace-shell";

/** Doctor workspace shell (SCREEN_CATALOG Page 4 stub — full dashboard is Phase 2). */
export default function DoctorPage() {
  return (
    <WorkspaceShell
      workspace="Doctor"
      title="Doctor workspace"
      nav={[
        { label: "Home", href: "/app/doctor", active: true },
        { label: "Schedule", href: "/app/doctor" },
        { label: "Patients", href: "/app/doctor" },
        { label: "Drafts", href: "/app/doctor" },
        { label: "Follow-ups", href: "/app/doctor" },
      ]}
    >
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-graphite">
          Verification
        </p>
        <p className="mt-1 font-sans text-sm font-semibold text-review">
          Pending — schedule, patients, and drafts unlock in the next phase.
        </p>
      </section>
    </WorkspaceShell>
  );
}
