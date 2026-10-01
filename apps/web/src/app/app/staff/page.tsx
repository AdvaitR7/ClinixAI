import { WorkspaceShell } from "@/components/workspace-shell";

/** Clinic staff workspace shell (SCREEN_CATALOG Page 23 stub — Phase 7). */
export default function StaffPage() {
  return (
    <WorkspaceShell
      workspace="Clinic staff"
      title="Staff workspace"
      nav={[
        { label: "Home", href: "/app/staff", active: true },
        { label: "Schedule", href: "/app/staff" },
        { label: "Patients", href: "/app/staff" },
        { label: "Follow-ups", href: "/app/staff" },
      ]}
    >
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-graphite">
          Membership
        </p>
        <p className="mt-1 font-sans text-sm text-ink">
          Practice membership controls arrive with staff invitations.
        </p>
      </section>
    </WorkspaceShell>
  );
}
