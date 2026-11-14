"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentView, LabObservationView, LabReportView, LabTrend, LabTrendPoint, UploadInitResponse } from "@clinix/schemas";
import { createIdentityRequest, useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PatientVisitHeader, patientVisitNav } from "@/components/patient-visit-header";
import { Skeleton } from "@/components/skeleton";
import { VaultDialog } from "@/components/vault-dialog";
import { VaultSourcePreview } from "@/components/vault-source-preview";

const DOC_TYPES = ["LAB_REPORT", "PRESCRIPTION", "IMAGING_REPORT", "DISCHARGE_SUMMARY", "CONSULTATION_NOTE", "OTHER"] as const;
const nav = patientVisitNav.map((item) => ({ ...item, active: item.label === "Reports" }));
const actionClass = "min-h-11 text-xs text-botanical underline-offset-4 hover:underline disabled:opacity-40";

/** Shows a source date without inventing collection metadata or page counts. */
function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Keeps refreshed source/report data together without unmounting active correction forms. */
function useVaultData() {
  const { getToken } = useAuth();
  const [documents, setDocuments] = useState<DocumentView[] | null>(null);
  const [reports, setReports] = useState<LabReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    const revision = ++requestNumber.current;
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    try {
      const token = await getToken();
      if (!token || signal.aborted) return;
      const [docs, labs] = await Promise.all([
        fetchApi<DocumentView[]>(token, "/patients/self/documents", { signal }),
        fetchApi<LabReportView[]>(token, "/patients/self/lab-reports", { signal }),
      ]);
      if (!signal.aborted && revision === requestNumber.current) {
        setDocuments(docs); setReports(labs); setError(null);
      }
    } catch (cause) {
      if (!signal.aborted && revision === requestNumber.current) setError(cause instanceof Error ? cause.message : "Vault unavailable.");
    }
  }, [getToken]);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    queueMicrotask(() => { if (!controller.signal.aborted) void refresh(); });
    return () => controller.abort();
  }, [refresh]);
  const processing = documents?.some((doc) => doc.processing_status === "PROCESSING") ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      if (pending.current) return;
      pending.current = true;
      void refresh().finally(() => { pending.current = false; });
    }, 3000);
    return () => clearInterval(timer);
  }, [processing, refresh]);
  return { documents, reports, error, refresh };
}

/** Draws only recorded, unit-compatible values; range and clinical improvement are never inferred. */
function Sparkline({ points, testName }: { points: LabTrendPoint[]; testName: string }) {
  if (!points.length) return <p className="py-8 text-xs text-graphite">No dated numeric observations for this measurement.</p>;
  const values = points.map((point) => point.value_numeric);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = points.map((point, i) => ({ x: 12 + i * 276 / Math.max(points.length - 1, 1), y: 105 - (point.value_numeric - min) * 80 / range }));
  return <>
    <svg viewBox="0 0 300 145" role="img" aria-label={`${testName} recorded values: ${values.join(", ")}`} className="mt-4 h-auto w-full">
      {[25, 65, 105].map((y) => <line key={y} x1="10" x2="290" y1={y} y2={y} stroke="#dce5e6" />)}
      <polyline points={coords.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#075f56" strokeWidth="2" />
      {coords.map((point, i) => <g key={i}><circle cx={point.x} cy={point.y} r="4" fill={i === coords.length - 1 ? "#075f56" : "#ffffff"} stroke="#075f56" /><text x={point.x} y="135" textAnchor="middle" fontSize="8" fill="#3d4640">{new Date(points[i].observed_at).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</text></g>)}
    </svg>
    <p className="mt-2 break-words text-xs">{values.join(" → ")}</p>
  </>;
}

/** Uses a keyed measurement panel so late trend responses cannot replace another selection. */
function TrendPanel({ name, units }: { name: string; units: Set<string> }) {
  const trend = useApiData<LabTrend>(`/patients/self/lab-observations?test_name=${encodeURIComponent(name)}`);
  return <>
    {trend.status === "loading" && <p role="status" className="py-8 text-xs">Loading trend…</p>}
    {trend.status === "error" && <div role="alert" className="py-4 text-xs text-critical"><p>{trend.error}</p><button type="button" className={actionClass} onClick={() => void trend.refresh()}>Retry trend</button></div>}
    {trend.status === "ready" && (units.size > 1 ? <p className="py-6 text-xs text-review">These observations use different units. Review the individual sources before comparing values.</p> : <>
      <p className="mt-2 text-[13px]">{trend.data.points.at(-1)?.value_numeric ?? "—"} {Array.from(units)[0]}</p>
      <Sparkline points={trend.data.points} testName={name} />
    </>)}
  </>;
}

/** Confirms a single uncertain value, preserving edits and providing actionable API errors. */
function ObservationCorrection({ observation, onSaved }: { observation: LabObservationView; onSaved: () => Promise<void> }) {
  const { getToken } = useAuth();
  const [value, setValue] = useState(String(observation.value_numeric ?? observation.value_text ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  /** Stores exactly one numeric or text value and refreshes source, report and trend state. */
  async function confirm() {
    if (saving.current) return;
    if (!value.trim()) { setError("Enter the value shown on the original source."); return; }
    const numeric = Number(value.trim());
    if (observation.value_numeric != null && !Number.isFinite(numeric)) { setError("Enter a finite numeric value from the source."); return; }
    saving.current = true; setBusy(true); setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in to confirm a value.");
      await fetchApi(token, `/patients/self/lab-observations/${observation.id}`, { method: "PATCH", body: JSON.stringify({
        ...(observation.value_numeric != null ? { value_numeric: numeric } : { value_text: value.trim() }), confirmed: true,
      }) });
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm this value."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="mt-3 border-t border-hairline pt-3">
    <label htmlFor={`value-${observation.id}`} className="block text-xs">Correct {observation.test_name} value</label>
    <div className="mt-1 flex flex-wrap gap-2">
      <input id={`value-${observation.id}`} value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} className="min-h-11 w-24 min-w-0 rounded-xl border border-sage bg-surface px-2 text-xs" />
      <button type="button" disabled={busy} onClick={() => void confirm()} className="min-h-11 rounded-xl border border-sage px-3 text-xs text-botanical disabled:opacity-50">{busy ? "Saving…" : "Confirm value"}</button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-critical">{error}</p>}
  </div>;
}

/** Keeps all transient clinical state scoped to the currently authenticated patient identity. */
export default function VaultPage() {
  const { identityVersion } = useAuth();
  return <VaultWorkspace key={identityVersion} />;
}

/** Implements the Phase 4 source shelf, extraction queue, observations, trends and source drawer. */
function VaultWorkspace() {
  const { getToken } = useAuth();
  const data = useVaultData();
  const docs = data.documents ?? [];
  const reports = data.reports ?? [];
  const [dialog, setDialog] = useState<"upload" | "shelf" | { documentId: string } | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const observationsRef = useRef<HTMLElement>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [trendName, setTrendName] = useState<string | null>(null);
  const [trendRevision, setTrendRevision] = useState(0);
  const [docType, setDocType] = useState<string>("LAB_REPORT");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadReceipt = useRef<{ init: UploadInitResponse; stored: boolean } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const report = reports.find((item) => item.report_id === reportId) ?? reports[0];
  const measurements = Array.from(new Set(reports.flatMap((item) => item.observations.map((field) => field.test_name))));
  const measurement = measurements.includes(trendName ?? "") ? trendName! : measurements.includes("Vitamin D") ? "Vitamin D" : measurements[0];
  const queue = docs.filter((doc) => doc.processing_status !== "COMPLETE");
  const source = report && docs.find((doc) => doc.document_id === report.source_document_id);

  /** Opens a source or local workflow while retaining the correct keyboard return target. */
  function open(next: typeof dialog, button: HTMLButtonElement) { returnFocusRef.current = button; setDialog(next); }
  /** Returns from a source to its own report and focuses the observations section. */
  function showObservations(id: string) {
    setReportId(id); setDialog(null);
    requestAnimationFrame(() => { observationsRef.current?.scrollIntoView({ block: "start" }); observationsRef.current?.focus(); });
  }
  /** Starts or retries extraction only after the signed storage upload has succeeded. */
  async function upload() {
    if (!file || operation.current) return;
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type) || file.size === 0) { setUploadError("Choose a non-empty PDF, PNG or JPEG file."); return; }
    const controller = new AbortController();
    const request = createIdentityRequest(controller.signal);
    operation.current = controller; setUploading(true); setUploadError(null); setNotice(null);
    try {
      const token = await getToken();
      if (!token || request.signal.aborted) throw new Error("Sign in to upload a document.");
      const init = uploadReceipt.current?.init ?? await fetchApi<UploadInitResponse>(token, "/patients/self/documents/upload-init", { method: "POST", body: JSON.stringify({ filename: file.name, mime_type: file.type, document_type: docType }), signal: request.signal });
      uploadReceipt.current ??= { init, stored: false };
      if (!uploadReceipt.current.stored) {
        const response = await fetch(init.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file, signal: request.signal });
        if (!response.ok) throw new Error(`File upload failed (${response.status}). Processing has not been started.`);
        uploadReceipt.current.stored = true;
      }
      await fetchApi(token, `/patients/self/documents/${init.document_id}/upload-complete`, { method: "POST", body: "{}", signal: request.signal });
      if (request.signal.aborted) return;
      uploadReceipt.current = null; setFile(null); setDialog(null); setNotice("Upload received. Processing status will refresh automatically.");
      await data.refresh();
    } catch (cause) { if (!request.signal.aborted) setUploadError(cause instanceof Error ? cause.message : "Upload failed."); }
    finally { request.release(); operation.current = null; if (!request.signal.aborted) setUploading(false); }
  }
  /** Reuses the owned upload-complete endpoint for a failed extraction without uploading duplicate bytes. */
  async function retryProcessing(id: string) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setRetrying(id); setNotice(null); setRetryError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in to retry processing.");
      await fetchApi(token, `/patients/self/documents/${id}/upload-complete`, { method: "POST", body: "{}", signal: controller.signal });
      if (!controller.signal.aborted) { setNotice("Processing requested."); await data.refresh(); }
    } catch (cause) { if (!controller.signal.aborted) setRetryError(cause instanceof Error ? cause.message : "Retry failed."); }
    finally { operation.current = null; if (!controller.signal.aborted) setRetrying(null); }
  }
  /** Refreshes all extraction consumers after a saved correction, including the active trend. */
  async function corrected() { await data.refresh(); setTrendRevision((value) => value + 1); }
  /** Selects the matching lab report, or shows the source when no editable patient lab values exist. */
  function review(doc: DocumentView, button: HTMLButtonElement) {
    const related = reports.find((item) => item.source_document_id === doc.document_id);
    if (related) showObservations(related.report_id);
    else open({ documentId: doc.document_id }, button);
  }

  return <WorkspaceShell workspace="Patient" title="Health Vault" nav={nav} focused flowNavigation hideHeading
    headerContent={<PatientVisitHeader backHref="/app/patient" action={<button type="button" onClick={(event) => open("upload", event.currentTarget)} className="min-h-11 rounded-full border border-sage bg-surface px-3 text-xs text-clear-info">＋ Upload</button>} />}>
    <div>
      <p className="text-xs tracking-[0.12em] text-graphite">PATIENT RECORD · SOURCE DOCUMENTS</p>
      <h1 className="mt-3 text-[30px] font-normal leading-tight text-botanical">Health Vault</h1>
      <p className="mt-2 text-xs leading-[19px] text-graphite">Keep original documents, extracted observations, and trends together — with the source always one tap away.</p>
    </div>
    {data.error && <div role="alert" className="rounded-2xl border border-critical p-4 text-xs text-critical"><p>{data.error}</p><button type="button" onClick={() => void data.refresh()} className={actionClass}>Retry vault</button></div>}
    {retryError && <p role="alert" className="text-xs text-critical">{retryError}</p>}
    {notice && <p role="status" className="text-xs text-botanical">{notice}</p>}
    <section aria-label="Vault status" className="rounded-[28px] bg-sage/20 p-[5px]">
      <div className="clinix-card flex items-center justify-between gap-3 p-4">
        <div><p className="text-xs tracking-wider text-graphite">VAULT STATUS</p>
          <p className="mt-2 text-lg">{data.documents ? `${docs.length} source documents` : "Loading sources…"}</p>
          <p className="mt-1 text-xs text-graphite">{docs.filter((doc) => doc.processing_status === "COMPLETE").length} complete · {docs.filter((doc) => doc.processing_status === "PROCESSING").length} processing · {docs.filter((doc) => doc.processing_status === "NEEDS_REVIEW").length} needs review</p>
        </div><span className="rounded-full bg-botanical px-4 py-2 text-xs text-surface">PRIVATE</span>
      </div>
    </section>
    <section aria-label="Document shelf">
      <p className="text-xs tracking-[0.12em] text-graphite">DOCUMENT SHELF</p>
      <div className="mt-1 flex items-center justify-between gap-3"><h2 className="text-[21px]">Recent sources</h2><button type="button" onClick={(event) => open("shelf", event.currentTarget)} disabled={!docs.length} className={actionClass}>View all {docs.length}</button></div>
      {!data.documents && !data.error && <Skeleton className="mt-3 h-40 rounded-2xl" />}
      {data.documents && !docs.length && <p className="clinix-card mt-3 p-5 text-xs">No source documents yet. Upload a document to get started.</p>}
      <div className="mt-2 grid grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] gap-3">
        {docs.slice(0, 3).map((doc, index) => <button key={doc.document_id} type="button" onClick={(event) => open({ documentId: doc.document_id }, event.currentTarget)} className={`clinix-card flex min-w-0 flex-col items-start justify-start text-left ${index === 0 ? "row-span-2 p-4" : "p-3"}`}>
          <span className={index === 0 ? "inline-block rounded-full bg-botanical px-4 py-1.5 text-xs text-surface" : "text-xs text-graphite"}>{doc.mime_type === "application/pdf" ? "PDF" : "PHOTO"}</span>
          <p className={`mt-3 break-words ${index === 0 ? "text-base" : "text-xs"}`}>{doc.original_filename}</p>
          <p className="mt-2 text-xs text-graphite">{dateLabel(doc.created_at)}</p>
          {index === 0 && <p className="mt-4 text-xs text-clear-info">Preview source →</p>}
        </button>)}
      </div>
    </section>
    <section aria-label="Processing documents">
      <p className="mb-4 text-xs tracking-[0.12em] text-graphite">UPLOAD QUEUE + OCR</p>
      <div className="clinix-card p-[18px]"><div className="flex justify-between gap-3"><h2 className="text-base">Processing documents</h2><span className="text-xs text-graphite">{queue.length} pending</span></div>
        {!queue.length && <p className="mt-4 text-xs text-graphite">No documents awaiting processing or review.</p>}
        <ul className="divide-y divide-hairline">{queue.map((doc) => <li key={doc.document_id} className="py-4 text-xs">
          <div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words">{doc.original_filename}</p>
            {doc.processing_status === "NEEDS_REVIEW" && <button type="button" onClick={(event) => review(doc, event.currentTarget)} className="min-h-11 shrink-0 rounded-full border border-review px-4 text-xs text-review">REVIEW</button>}
          </div>
          <p className={`mt-2 text-xs ${["NEEDS_REVIEW", "FAILED"].includes(doc.processing_status) ? "text-review" : "text-graphite"}`}>{doc.processing_status === "PROCESSING" ? "Extracting text…" : doc.processing_status === "UPLOADED" ? "Awaiting upload completion" : doc.processing_status === "NEEDS_REVIEW" ? "OCR complete · review required" : "Processing failed"}</p>
          {["FAILED", "UPLOADED"].includes(doc.processing_status) && <button type="button" disabled={!!retrying} onClick={() => void retryProcessing(doc.document_id)} className={actionClass}>{retrying === doc.document_id ? "Requesting…" : doc.processing_status === "UPLOADED" ? "Check uploaded file" : "Retry processing"}</button>}
        </li>)}</ul>
      </div>
    </section>
    <section ref={observationsRef} tabIndex={-1} aria-label="Extracted observations">
      <p className="text-xs tracking-[0.12em] text-graphite">EXTRACTED OBSERVATIONS</p>
      <div className="mt-1 flex items-center justify-between gap-3"><h2 className="min-w-0 break-words text-[21px]">{report ? `From ${source?.original_filename ?? report.laboratory_name ?? "lab report"}` : "Lab observations"}</h2>
        {report && <button type="button" onClick={(event) => open({ documentId: report.source_document_id }, event.currentTarget)} className={`${actionClass} shrink-0`}>Open source</button>}
      </div>
      {reports.length > 1 && <div className="my-3"><label htmlFor="report-select" className="text-xs">Select report</label><select id="report-select" value={report?.report_id ?? ""} onChange={(event) => setReportId(event.target.value)} className="clinix-field mt-1 text-xs">{reports.map((item) => <option key={item.report_id} value={item.report_id}>{docs.find((doc) => doc.document_id === item.source_document_id)?.original_filename ?? item.laboratory_name ?? "Lab report"} · {item.collection_date ?? "Collection date unavailable"}</option>)}</select></div>}
      <div className="clinix-card mt-3 overflow-hidden p-4">
        {!data.reports && !data.error && <Skeleton className="h-40 rounded-2xl" />}
        {!report && data.reports && <p className="py-4 text-xs">No extracted lab observations yet.</p>}
        {report && <>
          <table className="w-full table-fixed text-left"><colgroup><col className="w-[44%]" /><col className="w-[29%]" /><col className="w-[27%]" /></colgroup><thead><tr className="border-b border-hairline text-xs tracking-wider text-graphite"><th className="pb-3 font-normal">TEST</th><th className="pb-3 font-normal">RESULT</th><th className="pb-3 font-normal">REFERENCE</th></tr></thead>
            <tbody>{report.observations.map((field) => <tr key={field.id} className="border-b border-hairline last:border-0"><td className="py-4 pr-2 align-top text-xs"><p className="break-words">{field.test_name}</p><p className={`mt-2 text-xs ${field.flag ? "text-review" : "text-botanical"}`}>{field.flag === "LOW" ? "Below range" : field.flag === "HIGH" ? "Above range" : field.flag ?? ""}</p>{field.confirmed_at && <p className="mt-1 text-xs text-botanical">Patient confirmed</p>}{field.needs_review && <ObservationCorrection key={`${field.id}-${field.confirmed_at}`} observation={field} onSaved={corrected} />}</td><td className="break-words py-4 pr-2 align-top text-xs">{field.value_numeric ?? field.value_text ?? "—"} {field.unit}</td><td className="break-words py-4 align-top text-xs text-graphite">{field.reference_text ?? "Not supplied"}</td></tr>)}</tbody>
          </table>
          {!report.observations.length && <p className="py-4 text-xs">No observations were extracted from this report.</p>}
          <p className="mt-3 text-xs leading-[14px] text-graphite">Values are transcribed from the selected source. Review the original if anything looks wrong.</p>
        </>}
      </div>
    </section>
    <section aria-label="Longitudinal trends"><p className="mb-4 text-xs tracking-[0.12em] text-graphite">LONGITUDINAL TRENDS</p><div className="clinix-card p-[18px]">
      <h2 className="text-lg">{measurement ?? "Measurements"}</h2>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Trend measurements">{measurements.map((name) => <button key={name} type="button" aria-pressed={name === measurement} onClick={() => setTrendName(name)} className={`min-h-11 rounded-full border border-sage px-4 text-xs ${name === measurement ? "bg-botanical text-surface" : "text-graphite"}`}>{name}</button>)}</div>
      {measurement ? <TrendPanel key={`${measurement}-${trendRevision}-${reports.flatMap((item) => item.observations.filter((field) => field.test_name === measurement).map((field) => `${field.id}:${field.value_numeric}:${field.unit}`)).join("|")}`} name={measurement} units={new Set(reports.flatMap((item) => item.observations.filter((field) => field.test_name === measurement).map((field) => field.unit ?? "")))} /> : <p className="py-5 text-xs">Trends appear after dated numeric lab values are extracted.</p>}
    </div></section>
    <div className="clinix-card flex items-center gap-5 rounded-2xl p-4 text-xs leading-4 text-graphite"><span aria-hidden="true" className="text-botanical">i</span><p>Original files are preserved. Extracted values always link back to their source.</p></div>
    {dialog && <VaultDialog titleId="vault-dialog-title" returnFocusRef={returnFocusRef} onClose={() => setDialog(null)} busy={uploading}>
      {typeof dialog === "object" ? <VaultSourcePreview key={dialog.documentId} documentId={dialog.documentId} reports={reports} onClose={() => setDialog(null)} onObservations={showObservations} /> : <>
        <div className="flex items-center justify-between gap-3"><h2 id="vault-dialog-title" className="text-xl">{dialog === "upload" ? "Upload medical document" : "All sources"}</h2><button type="button" aria-label="Close" disabled={uploading} onClick={() => setDialog(null)} className="size-11 text-2xl disabled:opacity-40">×</button></div>
        {dialog === "upload" ? <div className="mt-5 space-y-4">
          <div><label htmlFor="doc-type" className="text-xs">Document type</label><select id="doc-type" disabled={uploading} value={docType} onChange={(event) => { uploadReceipt.current = null; setDocType(event.target.value); }} className="clinix-field mt-1 text-xs">{DOC_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>
          <div><label htmlFor="upload-file" className="text-xs">Select file (PNG, JPG, PDF)</label><input id="upload-file" type="file" disabled={uploading} accept=".png,.jpg,.jpeg,.pdf" onChange={(event) => { uploadReceipt.current = null; setFile(event.target.files?.[0] ?? null); }} className="mt-2 w-full text-xs file:mr-2 file:min-h-11 file:rounded-xl file:border file:border-sage file:bg-canvas file:px-2" /></div>
          {file && <p className="break-words text-xs">{file.name}</p>}
          {uploadError && <p role="alert" className="text-xs text-critical">{uploadError}</p>}
          <button type="button" onClick={() => void upload()} disabled={uploading || !file} className="min-h-12 w-full rounded-2xl bg-botanical px-3 text-xs text-surface disabled:opacity-50">{uploading ? "Uploading…" : "Upload to vault"}</button>
        </div> : <ul className="mt-4 divide-y divide-hairline">{docs.map((doc) => <li key={doc.document_id}><button type="button" onClick={() => setDialog({ documentId: doc.document_id })} className="min-h-16 w-full py-3 text-left"><p className="break-words text-xs">{doc.original_filename}</p><p className="mt-2 text-xs text-graphite">{dateLabel(doc.created_at)} · {doc.processing_status.replaceAll("_", " ")}</p></button></li>)}</ul>}
      </>}
    </VaultDialog>}
  </WorkspaceShell>;
}
