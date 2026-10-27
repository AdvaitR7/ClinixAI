"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  documentTypeSchema,
  type DocumentType,
  type ClaimInviteView,
  type DocumentView,
  type DoctorWorkspace,
  type UploadInitResponse,
} from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { Skeleton } from "@/components/skeleton";
import { createIdentityRequest, useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];
const card = "rounded-[22px] border border-copper bg-graphite p-4";
const action =
  "flex min-h-[52px] w-full items-center justify-center rounded-[18px] border border-copper px-4 text-center font-sans text-xs font-semibold uppercase disabled:opacity-50";
const sections = ["Overview", "Timeline", "Reports", "Meds"] as const;

/** Formats source timestamps without presenting a fabricated fallback date. */
function at(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Keeps record headings and clinical text consistent across compact and full views. */
function RecordSection({
  id,
  title,
  children,
  condensed = false,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  condensed?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2
        className={
          condensed ? "sr-only" : "font-sans text-xl font-semibold text-surface"
        }
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** SCR-028/029: composes only supplied record facts and connects supported clinical actions. */
export function DoctorPatientRecord({
  patientId,
  compact = false,
}: {
  patientId: string;
  compact?: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const state = useApiData<DoctorWorkspace>(
    `/doctor/patients/${patientId}/workspace`,
  );
  const [latest, setLatest] = useState<DoctorWorkspace | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [openedAt] = useState(() => Date.now());
  const [dialog, setDialog] = useState<
    "timeline" | "meds" | "scope" | "upload" | "source" | null
  >(null);
  const dialogOrigin = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<ClaimInviteView | null>(null);
  const [source, setSource] = useState<DocumentView | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("OTHER");
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [appointmentId, setAppointmentId] = useState("");
  const [uploadDocumentId, setUploadDocumentId] = useState<string | null>(null);
  const [uploadSession, setUploadSession] = useState<UploadInitResponse | null>(
    null,
  );
  const latestRequest = useRef(0);
  const loadedRecord = latest ?? (state.status === "ready" ? state.data : null);
  const processing =
    loadedRecord?.documents?.some(
      (document) => document.processing_status === "PROCESSING",
    ) ?? false;

  // Refresh extraction results quietly so an open record dialog keeps its focus and edits.
  useEffect(() => {
    if (!processing) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      const revision = ++latestRequest.current;
      void (async () => {
        try {
          const token = await getToken();
          if (!token || controller.signal.aborted) return;
          const result = await fetchApi<DoctorWorkspace>(
            token,
            `/doctor/patients/${patientId}/workspace`,
            { signal: controller.signal },
          );
          if (
            !controller.signal.aborted &&
            revision === latestRequest.current
          ) {
            setLatest(result);
            setRefreshError(null);
          }
        } catch {
          if (!controller.signal.aborted)
            setRefreshError("Extraction status could not refresh. Retrying…");
        } finally {
          pending = false;
        }
      })();
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [processing, getToken, patientId]);

  useEffect(() => {
    const update = () =>
      setActiveTab(window.location.hash.slice(1) || "overview");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  /** Opens an in-record overlay and remembers its keyboard return target. */
  function open(kind: NonNullable<typeof dialog>, origin: HTMLButtonElement) {
    dialogOrigin.current = origin;
    setError(null);
    setDialog(kind);
  }

  /** Loads the exact authorized original rather than substituting a report fixture. */
  async function viewSource(documentId: string, origin: HTMLButtonElement) {
    open("source", origin);
    setSource(null);
    setSourceLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      setSource(
        await fetchApi<DocumentView>(token, `/doctor/documents/${documentId}`),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open source",
      );
    } finally {
      setSourceLoading(false);
    }
  }

  /** Creates an encounter for this patient before opening the existing direct composer. */
  async function createPrescription() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const result = await fetchApi<{ encounter_id: string }>(
        token,
        "/doctor/encounters",
        { method: "POST", body: JSON.stringify({ patient_id: patientId }) },
      );
      router.push(
        `/app/doctor/prescription-drafts/new?encounterId=${encodeURIComponent(result.encounter_id)}&patientId=${encodeURIComponent(patientId)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create prescription encounter",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Generates the existing one-time claim code without implying delivery or verification. */
  async function generateInvite() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      setInvite(
        await fetchApi<ClaimInviteView>(
          token,
          `/doctor/patients/${patientId}/claim-invites`,
          { method: "POST", body: "{}" },
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not generate claim invite",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Confirms a real storage PUT before completing the document upload; failed completion can retry. */
  async function upload() {
    if (!file) {
      setError("Choose a PDF, PNG or JPEG file.");
      return;
    }
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setError("Choose a PDF, PNG or JPEG file.");
      return;
    }
    setBusy(true);
    setError(null);
    const identity = createIdentityRequest();
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      let documentId = uploadDocumentId;
      if (!documentId) {
        const initialized =
          uploadSession ??
          (await fetchApi<UploadInitResponse>(
            token,
            `/doctor/patients/${patientId}/documents/upload-init`,
            {
              method: "POST",
              body: JSON.stringify({
                filename: file.name,
                mime_type: file.type,
                document_type: documentType,
              }),
              signal: identity.signal,
            },
          ));
        setUploadSession(initialized);
        const result = await fetch(initialized.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
          signal: identity.signal,
        });
        if (!result.ok) {
          if (result.status === 401 || result.status === 403)
            setUploadSession(null);
          throw new Error(
            "The file upload failed. Retry before completing the record.",
          );
        }
        documentId = initialized.document_id;
        setUploadDocumentId(documentId);
      }
      await fetchApi(
        token,
        `/doctor/patients/${patientId}/documents/${documentId}/upload-complete`,
        { method: "POST", body: "{}", signal: identity.signal },
      );
      setUploaded(file.name);
      setDialog(null);
      setFile(null);
      setUploadDocumentId(null);
      setUploadSession(null);
      const revision = ++latestRequest.current;
      const refreshed = await fetchApi<DoctorWorkspace>(
        token,
        `/doctor/patients/${patientId}/workspace`,
        { signal: identity.signal },
      );
      if (revision === latestRequest.current) setLatest(refreshed);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not upload record",
      );
    } finally {
      identity.release();
      setBusy(false);
    }
  }

  if (state.status === "loading")
    return (
      <WorkspaceShell workspace="Doctor" title="Patient record" nav={nav}>
        <Skeleton className="h-64 rounded-[22px]" />
      </WorkspaceShell>
    );
  if (state.status === "error")
    return (
      <WorkspaceShell workspace="Doctor" title="Patient record" nav={nav}>
        <section role="alert" className={card}>
          <p className="text-critical">{state.error}</p>
          <button
            type="button"
            onClick={() => state.refresh()}
            className="mt-3 min-h-11 text-evidence underline"
          >
            Retry record
          </button>
          <Link
            href="/app/doctor/patients"
            className="mt-3 block text-evidence"
          >
            Back to directory
          </Link>
        </section>
      </WorkspaceShell>
    );

  const record = latest ?? state.data;
  const recordUrl = `/app/doctor/patients/${patientId}`;
  const medications = record.medications ?? [];
  const current = medications.filter(
    (medicine) => medicine.status === "CURRENT",
  );
  const visits = record.appointments
    .filter((appointment) => appointment.status === "CONFIRMED")
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const next = visits.find(
    (visit) => new Date(visit.scheduled_start).getTime() >= openedAt,
  );
  const selected =
    visits.find((visit) => visit.id === appointmentId) ??
    (visits.length === 1 ? visits[0] : next);
  const lastUpdated = record.last_updated_at;
  const documents = record.documents ?? [];
  const reports = record.reports ?? [];
  const initials = record.identity.full_name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  /** Shows available timeline events with their supplied source authority. */
  const locked = record.locked_sections ?? [];
  const lockedNames = locked.map((section) => section.section_name);
  // Locked groups are listed explicitly instead of being silently omitted.
  const lockedList = locked.length > 0 && (
    <ul className="mt-3 space-y-1 text-xs" aria-label="Locked record groups">
      {locked.map((section) => (
        <li key={section.section_name}>Locked · {section.section_name} — {section.reason}</li>
      ))}
    </ul>
  );
  const timeline = (all = false) => (
    <div className={`${card} space-y-3`}>
      {compact && !all && (
        <>
          <p className="clinix-label text-copper">Recent clinical record</p>
          <h3 className="text-lg">Recent encounters</h3>
        </>
      )}
      {record.timeline.length === 0 ? (
        <p>No clinical activity recorded.</p>
      ) : (
        (all ? record.timeline : record.timeline.slice(0, 4)).map(
          (entry, index) => (
            <article
              key={`${entry.kind}-${entry.id ?? index}`}
              className="border-b border-copper/30 pb-3 last:border-0"
            >
              <time className="text-xs text-copper">{at(entry.at)}</time>
              <p className="mt-1">{entry.label}</p>
              <p className="mt-1 text-xs text-evidence">
                {entry.provenance?.replaceAll("_", " ") ??
                  "Source not recorded"}
              </p>
            </article>
          ),
        )
      )}
      {compact && !all && (
        <button
          type="button"
          onClick={(event) => open("timeline", event.currentTarget)}
          className="min-h-11 text-xs text-evidence"
        >
          Open full timeline →
        </button>
      )}
    </div>
  );
  const history = (
    <div className={`${card} space-y-3`}>
      {medications.length === 0 ? (
        <p>No medication history recorded in this access scope.</p>
      ) : (
        medications.map((medicine, index) => (
          <article
            key={`${medicine.prescription_id}-${index}`}
            className="border-b border-copper/30 pb-3 last:border-0"
          >
            <p className="font-semibold">{medicine.medicine_name}</p>
            <p className="mt-1 text-xs">
              {[medicine.dose, medicine.route, medicine.frequency]
                .filter(Boolean)
                .join(" · ") || "Details not recorded"}
            </p>
            <p className="mt-1 text-xs text-evidence">
              {medicine.status === "UNKNOWN_STATUS"
                ? "Current use not confirmed"
                : medicine.status}{" "}
              · {at(medicine.prescribed_date)}
            </p>
            {medicine.prescription_id &&
              (record.prescriptions ?? []).some(
                (rx) => rx.id === medicine.prescription_id,
              ) && (
                <Link
                  className="mt-2 inline-block min-h-11 py-3 text-xs text-evidence underline"
                  href={`/app/doctor/prescriptions/${medicine.prescription_id}`}
                >
                  Open original prescription
                </Link>
              )}
          </article>
        ))
      )}
    </div>
  );

  return (
    <WorkspaceShell
      workspace="Doctor"
      title={compact ? "Patient clinical workspace" : "Patient record"}
      nav={nav}
      focused
      hideHeading
      hideNavigation={compact}
      headerAction={
        compact ? (
          <Link
            href="/app/doctor/patients"
            className="inline-flex min-h-11 items-center text-xs text-evidence"
          >
            Close
          </Link>
        ) : undefined
      }
    >
      <div className="mx-auto w-full max-w-[393px] space-y-6 pb-10 font-sans text-sm text-surface">
        <Link
          href="/app/doctor/patients"
          aria-label="Back to directory"
          className="inline-flex min-h-11 items-center gap-3 text-xs text-copper"
        >
          ← {compact ? "PATIENT CLINICAL WORKSPACE" : "Back to directory"}
        </Link>
        {!compact && (
          <p className="clinix-label text-copper">
            Patient record · Longitudinal clinical dossier
          </p>
        )}
        <header className={card}>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-copper font-semibold uppercase text-ink"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold">
                {record.identity.full_name || "Patient name unavailable"}
              </h1>
              <p className="mt-1 break-all text-xs text-doctor-muted">
                <span title={patientId}>Record {patientId.slice(0, 8)}</span> ·{" "}
                {record.status === "UNCLAIMED"
                  ? "Unclaimed record"
                  : "Linked patient record"}
              </p>
              <p className="mt-2 text-xs">
                Mobile ending {record.identity.phone_last4 || "not recorded"}
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-copper/40 pt-3">
            {compact && (
              <p className="mb-2 text-xs">
                Next:{" "}
                {next
                  ? at(next.scheduled_start)
                  : "No confirmed appointment scheduled"}
              </p>
            )}
            <p className="text-xs text-evidence">
              {record.consent_active === true
                ? "Consent reported active"
                : record.consent_active === false
                  ? "No active patient consent"
                  : "Consent status unavailable"}
            </p>
            <p className="mt-1 text-xs">
              {record.access_scope === "DOCTOR_OWN_RECORDS"
                ? "Access: your clinical records only"
                : record.access_scope === "CONSENT_SCOPED"
                  ? "Access: your records plus what the patient shared"
                  : "Access scope not recorded"}
            </p>
          </div>
          {!compact && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-copper/40 pt-3 text-xs">
              <div>
                <dt className="text-copper">Documented allergy</dt>
                <dd className="mt-1">
                  {record.allergies.length
                    ? record.allergies.join(", ")
                    : "Allergy status not confirmed"}
                </dd>
              </div>
              <div>
                <dt className="text-copper">Current conditions</dt>
                <dd className="mt-1">Not available</dd>
              </div>
              <div>
                <dt className="text-copper">Primary doctor</dt>
                <dd className="mt-1">Not available</dd>
              </div>
              <div>
                <dt className="text-copper">Last activity</dt>
                <dd className="mt-1">{at(lastUpdated)}</dd>
              </div>
            </dl>
          )}
        </header>
        {compact && (
          <section className={`${card} border-critical`}>
            <h2 className="clinix-label text-critical">Documented safety</h2>
            <p className="mt-2">
              {record.allergies.length
                ? record.allergies.join(", ")
                : "Allergy status not confirmed"}
            </p>
          </section>
        )}
        {record.status === "UNCLAIMED" && (
          <section className={card}>
            <h2 className="clinix-label text-copper">Unclaimed record</h2>
            {invite ? (
              <>
                <p className="mt-3 break-all font-mono text-xl text-copper">
                  {invite.invite_token}
                </p>
                <p className="mt-2 text-xs">Expires {at(invite.expires_at)}</p>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={generateInvite}
                className={`${action} mt-3 bg-copper text-ink`}
              >
                Generate claim invite
              </button>
            )}
          </section>
        )}
        {error && !dialog && (
          <p role="alert" className="text-critical">
            {error}
          </p>
        )}
        {uploaded && <p role="status">Uploaded {uploaded}.</p>}
        {refreshError && <p role="alert">{refreshError}</p>}
        {!compact && (
          <nav
            aria-label="Patient record sections"
            className="flex rounded-[18px] border border-copper bg-graphite p-1"
          >
            {sections.map((section) => (
              <Link
                key={section}
                href={`#${section.toLowerCase()}`}
                onClick={() => setActiveTab(section.toLowerCase())}
                aria-current={
                  activeTab === section.toLowerCase() ? "location" : undefined
                }
                className={`flex min-h-11 flex-1 items-center justify-center rounded-[14px] text-xs ${activeTab === section.toLowerCase() ? "bg-copper font-semibold text-ink" : "text-surface"}`}
              >
                {section}
              </Link>
            ))}
          </nav>
        )}
        {!compact && (
          <div className="rounded-[16px] border border-evidence bg-graphite p-4 text-xs">
            <p className="text-evidence">PATIENT RECORD</p>
            <p className="mt-1">
              Factual records, sources and authored clinical notes
            </p>
          </div>
        )}
        <RecordSection
          id="overview"
          condensed={compact}
          title={
            compact
              ? "Current consultation context"
              : "Current clinical overview"
          }
        >
          <div className={card}>
            <p className="clinix-label text-copper">
              {compact ? "Current consultation context" : "Current concern"}
            </p>
            <h3 className="mt-2 text-lg">
              {record.current_concern || "No concern recorded"}
            </h3>
            <p className="mt-2 text-xs text-evidence">
              {record.current_concern
                ? `Source: your encounter · ${at(record.current_concern_at)}`
                : "No check-in outcome is inferred."}
            </p>
            {compact && (
              <dl className="mt-3 space-y-2 text-xs">
                <div>
                  <dt className="text-copper">Recent check-in</dt>
                  <dd>{lockedNames.includes("AI check-in packet") ? "Not shared with you" : "Shared by the patient"}</dd>
                </div>
                <div>
                  <dt className="text-copper">Shared packet</dt>
                  <dd>{lockedNames.length === 0 ? "All groups shared" : `${lockedNames.length} groups locked`}</dd>
                </div>
              </dl>
            )}
            {compact && (
              <button
                type="button"
                onClick={(event) => open("scope", event.currentTarget)}
                className="mt-2 min-h-11 text-xs text-evidence"
              >
                Review consent scope →
              </button>
            )}
          </div>
          {!compact && (
            <div className="grid grid-cols-2 gap-3">
              <div className={card}>
                <p className="clinix-label text-copper">Current medicines</p>
                <p className="mt-2">
                  {current.length
                    ? `${current.length} confirmed current`
                    : "No current use confirmed"}
                </p>
                {current.map((medicine, index) => (
                  <p key={index} className="mt-2 text-xs">
                    {medicine.medicine_name}
                  </p>
                ))}
              </div>
              <div className={card}>
                <p className="clinix-label text-copper">Next appointment</p>
                <p className="mt-2">
                  {next
                    ? at(next.scheduled_start)
                    : "No confirmed visit scheduled"}
                </p>
                {next && (
                  <p className="mt-2 text-xs">
                    {next.appointment_type.replaceAll("_", " ")}
                  </p>
                )}
              </div>
            </div>
          )}
          {!compact && (
            <div className={card}>
              <h3 className="clinix-label text-copper">
                Recent clinical activity
              </h3>
              {record.timeline.length ? (
                record.timeline.slice(0, 3).map((entry, index) => (
                  <p
                    key={index}
                    className="mt-3 border-t border-copper/30 pt-2 text-xs"
                  >
                    {at(entry.at)} · {entry.label}
                  </p>
                ))
              ) : (
                <p className="mt-3">No clinical activity recorded.</p>
              )}
            </div>
          )}
        </RecordSection>
        <RecordSection
          id="timeline"
          condensed={compact}
          title={compact ? "Recent encounters" : "Timeline"}
        >
          {timeline()}
          {!compact && (
            <button
              type="button"
              onClick={(event) => open("timeline", event.currentTarget)}
              className="min-h-11 text-xs text-evidence"
            >
              Open full timeline →
            </button>
          )}
        </RecordSection>
        {!compact && (
          <RecordSection id="reports" title="Reports & Labs">
            {reports.map((report) => (
              <article key={report.report_id} className={card}>
                <h3 className="text-base font-semibold">
                  {report.laboratory_name || "Laboratory report"}
                </h3>
                <p className="mt-1 text-xs text-doctor-muted">
                  {report.report_date ||
                    report.collection_date ||
                    at(report.created_at)}
                </p>
                <table className="mt-4 w-full table-fixed text-left text-xs">
                  <thead className="text-copper">
                    <tr>
                      <th className="py-2">Test</th>
                      <th>Result</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.observations.map((observation) => (
                      <tr
                        key={observation.id}
                        className="border-t border-copper/30 align-top"
                      >
                        <td className="break-words py-3 pr-2">
                          {observation.test_name}
                        </td>
                        <td className="break-words pr-2">
                          {observation.value_numeric ??
                            observation.value_text ??
                            "Not recorded"}{" "}
                          {observation.unit}
                          <p className="mt-1 text-review">
                            {observation.needs_review
                              ? "Needs review"
                              : (observation.flag ?? "")}
                          </p>
                        </td>
                        <td className="break-words">
                          {observation.reference_text ||
                            [
                              observation.reference_low,
                              observation.reference_high,
                            ]
                              .map((value) => value ?? "—")
                              .join(" – ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={(event) =>
                    viewSource(report.source_document_id, event.currentTarget)
                  }
                  className="mt-2 min-h-11 text-xs text-evidence"
                >
                  Open report & source →
                </button>
              </article>
            ))}
            {reports.length === 0 && (
              <p className={card}>
                No extracted lab reports in this access scope.
              </p>
            )}
            {documents.map((document) => (
              <div key={document.document_id} className={card}>
                <p className="break-words">{document.original_filename}</p>
                <p className="mt-1 text-xs text-evidence">
                  {document.processing_status}
                </p>
                <button
                  type="button"
                  onClick={(event) =>
                    viewSource(document.document_id, event.currentTarget)
                  }
                  className="mt-2 min-h-11 text-xs text-evidence"
                >
                  Open original source →
                </button>
              </div>
            ))}
          </RecordSection>
        )}
        <RecordSection
          id="meds"
          condensed={compact}
          title={compact ? "Active medications" : "Medications & Prescriptions"}
        >
          {compact ? (
            <div className={card}>
              <p className="clinix-label mb-3 text-copper">
                Active medications
              </p>
              {current.length ? (
                current.map((medicine, index) => (
                  <p key={index} className="mb-2">
                    {medicine.medicine_name} · {medicine.dose} ·{" "}
                    {medicine.frequency}
                  </p>
                ))
              ) : (
                <p>No current medication use confirmed.</p>
              )}
              <button
                type="button"
                onClick={(event) => open("meds", event.currentTarget)}
                className="mt-2 min-h-11 text-xs text-evidence"
              >
                Open medication history →
              </button>
            </div>
          ) : (
            <>
              {history}
              <div className={card}>
                <h3 className="clinix-label text-copper">
                  Finalized prescriptions
                </h3>
                {record.prescriptions?.length ? (
                  record.prescriptions.map((prescription) => (
                    <Link
                      key={prescription.id}
                      href={`/app/doctor/prescriptions/${prescription.id}`}
                      className="mt-2 block min-h-11 py-3 text-xs text-evidence"
                    >
                      Finalized prescription · {at(prescription.finalized_at)} →
                    </Link>
                  ))
                ) : (
                  <p className="mt-3">
                    No finalized prescriptions in this access scope.
                  </p>
                )}
              </div>
            </>
          )}
          {!compact && (
            <button
              type="button"
              onClick={(event) => open("meds", event.currentTarget)}
              className="min-h-11 text-xs text-evidence"
            >
              {compact
                ? "Open medication history →"
                : "Open medication & prescription history →"}
            </button>
          )}
        </RecordSection>
        {compact ? (
          <section className="rounded-[18px] bg-surface p-4 text-xs text-ink">
            <h2 className="clinix-label text-copper">Role-based access</h2>
            <p className="mt-2">
              Your own clinical records are always shown. Other record groups
              open only while the patient’s consent covers them.
            </p>
            {lockedList}
          </section>
        ) : (
          <section className={`${card} border-review`}>
            <h2 className="clinix-label text-review">Consent-locked records</h2>
            <p className="mt-2">
              {lockedNames.length === 0
                ? "The patient has shared every record group with you."
                : "These groups are unavailable without the patient’s consent."}
            </p>
            {lockedList}
            <button
              type="button"
              onClick={(event) => open("scope", event.currentTarget)}
              className="mt-2 min-h-11 text-xs text-evidence"
            >
              Review access boundary
            </button>
          </section>
        )}
        {!compact && (
          <section className="space-y-3">
            <div className="rounded-[16px] border border-evidence p-4 text-xs text-evidence">
              AI ASSISTANCE · SEPARATE FROM PATIENT RECORD
            </div>
            <div className={`${card} border-evidence`}>
              <h2 className="text-lg font-semibold">
                Clinical context summary
              </h2>
              <p className="mt-3 text-xs">
                {lockedNames.includes("AI check-in packet")
                  ? "AI context appears when the patient shares a check-in packet. No generated summary, confidence or outcome is asserted."
                  : "The patient shared a check-in packet. Open it from the consultation to see the checked summary."}
              </p>
            </div>
          </section>
        )}
        <section className="space-y-3">
          <h2 className={compact ? "sr-only" : "clinix-label text-copper"}>
            Contextual actions
          </h2>
          {visits.length > 1 && (
            <label className="block text-xs">
              Consultation appointment
              <select
                aria-label="Consultation appointment"
                className="mt-2 min-h-11 w-full rounded-xl border border-copper bg-graphite p-3 text-surface"
                value={selected?.id ?? ""}
                onChange={(event) => setAppointmentId(event.target.value)}
              >
                <option value="">Select appointment</option>
                {visits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {at(visit.scheduled_start)} ·{" "}
                    {visit.reason || visit.appointment_type}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected ? (
            <Link
              href={`/app/doctor/consultation/${selected.id}`}
              className={`${action} bg-copper text-ink`}
            >
              {compact ? "Start consultation" : "Begin consultation"}
            </Link>
          ) : (
            <>
              <button
                type="button"
                disabled
                className={`${action} bg-copper text-ink`}
              >
                {compact ? "Start consultation" : "Begin consultation"}
              </button>
              <p className="text-xs text-doctor-muted">
                Select a confirmed appointment in Schedule before starting a
                consultation.
              </p>
              <Link
                href="/app/doctor/schedule"
                className="inline-flex min-h-11 items-center text-xs text-evidence"
              >
                Open schedule →
              </Link>
            </>
          )}
          {compact ? (
            <Link href={recordUrl} className={action}>
              Open patient record
            </Link>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={createPrescription}
                  className={action}
                >
                  Create prescription
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(event) => open("upload", event.currentTarget)}
                  className={action}
                >
                  Upload record
                </button>
              </div>
              <button type="button" disabled className={action}>
                Schedule follow-up
              </button>
              <p className="text-xs text-doctor-muted">
                Follow-up scheduling is not available yet.
              </p>
            </>
          )}
        </section>
        {dialog && (
          <ClinicalReviewDialog
            titleId="record-dialog-title"
            busy={busy}
            returnFocusRef={dialogOrigin}
            onClose={() => {
              setDialog(null);
              setError(null);
            }}
          >
            <h2
              id="record-dialog-title"
              className="mb-5 text-2xl font-semibold"
            >
              {dialog === "timeline"
                ? "Clinical timeline"
                : dialog === "meds"
                  ? "Medication history"
                  : dialog === "scope"
                    ? "Record access"
                    : dialog === "upload"
                      ? "Upload record"
                      : "Original source"}
            </h2>
            {dialog === "timeline" && timeline(true)}
            {dialog === "meds" && history}
            {dialog === "scope" && (
              <div className={card}>
                <p>
                  Scope:{" "}
                  {record.access_scope === "CONSENT_SCOPED"
                    ? "your records plus what the patient shared."
                    : "your clinical records only."}
                </p>
                <p className="mt-3">
                  Consent status:{" "}
                  {record.consent_active === true ? "active" : "none active"}.
                  Only the patient can change what is shared or extend it.
                </p>
                {lockedList}
              </div>
            )}
            {dialog === "upload" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void upload();
                }}
                className="space-y-4"
              >
                <label className="block text-sm" htmlFor="record-type">
                  Document type
                </label>
                <select
                  id="record-type"
                  disabled={busy || !!uploadSession}
                  value={documentType}
                  onChange={(event) =>
                    setDocumentType(event.target.value as DocumentType)
                  }
                  className="min-h-11 w-full rounded-xl border border-copper bg-graphite p-3"
                >
                  {documentTypeSchema.options.map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <label className="block text-sm" htmlFor="record-file">
                  Source document
                </label>
                <input
                  id="record-file"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setUploadDocumentId(null);
                    setUploadSession(null);
                    setError(null);
                  }}
                  className="w-full min-w-0 text-sm"
                />
                {file && <p className="break-words text-xs">Selected: {file.name}</p>}
                <button
                  type="submit"
                  disabled={busy || !file}
                  className={`${action} bg-copper text-ink`}
                >
                  {busy ? "Uploading…" : "Upload source document"}
                </button>
              </form>
            )}
            {dialog === "source" && (
              <>
                {sourceLoading && <p role="status">Loading original source…</p>}
                {source?.view_url &&
                  (source.mime_type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Preserve the signed original without an image proxy.
                    <img
                      src={source.view_url}
                      alt={`Original ${source.original_filename}`}
                      className="w-full rounded-xl"
                    />
                  ) : (
                    <iframe
                      title={`Original ${source.original_filename}`}
                      src={source.view_url}
                      className="h-[500px] w-full rounded-xl bg-surface"
                    />
                  ))}
                {source?.view_url && (
                  <a
                    href={source.view_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex min-h-11 items-center text-sm text-evidence underline"
                  >
                    Open original in new tab
                  </a>
                )}
                {source && !source.view_url && (
                  <p>Original source unavailable.</p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="mt-4 text-critical">
                {error}
              </p>
            )}
          </ClinicalReviewDialog>
        )}
      </div>
    </WorkspaceShell>
  );
}
