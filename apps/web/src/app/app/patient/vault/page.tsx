"use client";

import { createIdentityRequest, useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";
import type {
  DocumentView,
  LabReportView,
  LabTrend,
  LabTrendPoint,
  UploadInitResponse,
} from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient", disabled: true },
  { label: "Vault", href: "/app/patient/vault", active: true },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Care", href: "/app/patient/medications" },
];

const DOC_TYPES = [
  "LAB_REPORT",
  "PRESCRIPTION",
  "IMAGING_REPORT",
  "DISCHARGE_SUMMARY",
  "CONSULTATION_NOTE",
  "OTHER",
] as const;

function fmtNum(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** Inline SVG trend sparkline with accessible metrics. */
function Sparkline({ points }: { points: LabTrendPoint[] }) {
  if (points.length === 0) return <p className="font-sans text-xs text-graphite">No trend points available.</p>;
  const w = 320;
  const h = 80;
  const pad = 8;
  const vals = points.map((p) => p.value_numeric);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(points.length - 1, 1);
    const y = h - pad - ((p.value_numeric - min) / range) * (h - 2 * pad);
    return { x, y, val: p.value_numeric, date: p.observed_at, low: p.confidence != null && p.confidence < 0.85 };
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[11px] text-graphite">
        <span>Min: {min}</span>
        <span>Latest: {vals[vals.length - 1]}</span>
        <span>Max: {max}</span>
      </div>
      <div className="rounded-xl border border-hairline bg-canvas p-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full overflow-visible" role="img" aria-label="Lab value trend chart">
          <polyline
            fill="none"
            stroke="#12352c"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
          />
          {coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={c.low ? "4" : "3"}
              fill={c.low ? "#a65f11" : "#12352c"}
              stroke="#fffdfc"
              strokeWidth="1.5"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Page 9 — Health Vault & Document Hub (SCREEN_CATALOG §7, Figma 25:2 & 25:3). */
export default function VaultPage() {
  const { getToken } = useAuth();
  const docs = useApiData<DocumentView[]>("/patients/self/documents");
  const reports = useApiData<LabReportView[]>("/patients/self/lab-reports");

  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>("LAB_REPORT");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [drawer, setDrawer] = useState<DocumentView | null>(null);
  const [reportIdx, setReportIdx] = useState(0);
  const [trendTest, setTrendTest] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const hasProcessing =
    docs.status === "ready" &&
    docs.data.some(
      (d) => d.processing_status === "UPLOADED" || d.processing_status === "PROCESSING",
    );

  // Poll while any document is still uploading/processing.
  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(() => void docs.refresh(), 3000);
    return () => clearInterval(t);
  }, [hasProcessing, docs.refresh]);

  const trend = useApiData<LabTrend>(
    trendTest ? `/patients/self/lab-observations?test_name=${encodeURIComponent(trendTest)}` : null,
  );

  const allTestNames = Array.from(
    new Set(
      (reports.status === "ready" ? reports.data : []).flatMap((r) =>
        r.observations.map((o) => o.test_name),
      ),
    ),
  );

  async function upload() {
    if (!file) return;
    const identityRequest = createIdentityRequest();
    setUploading(true);
    setUploadError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const init = await fetchApi<UploadInitResponse>(
        token,
        "/patients/self/documents/upload-init",
        {
          method: "POST",
          body: JSON.stringify({ filename: file.name, mime_type: file.type, document_type: docType }),
        },
      );
      await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
        signal: identityRequest.signal,
      });
      await fetchApi(token, `/patients/self/documents/${init.document_id}/upload-complete`, {
        method: "POST",
        body: "{}",
      });
      setFile(null);
      await docs.refresh();
      await reports.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      identityRequest.release();
      setUploading(false);
    }
  }

  async function viewSource(documentId: string) {
    const token = await getToken();
    if (!token) return;
    const doc = await fetchApi<DocumentView>(token, `/patients/self/documents/${documentId}`);
    setDrawer(doc);
  }

  async function confirmObservation(id: string, valueText: string) {
    setConfirming(id);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const numeric = valueText.trim() !== "" && !Number.isNaN(Number(valueText))
        ? Number(valueText)
        : null;
      await fetchApi(token, `/patients/self/lab-observations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(
          numeric != null
            ? { value_numeric: numeric, confirmed: true }
            : { value_text: valueText, confirmed: true },
        ),
      });
      await reports.refresh();
    } finally {
      setConfirming(null);
    }
  }

  return (
    <WorkspaceShell workspace="Patient" title="Health vault" nav={nav}>
      {/* Upload section */}
      <section className="clinix-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-botanical">Intake & storage</p>
            <h2 className="mt-1 font-sans text-xl font-bold text-ink">Upload medical document</h2>
          </div>
          <span className="rounded-full border border-sage px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-botanical">
            Encrypted
          </span>
        </div>
        <p className="mt-1.5 font-sans text-xs leading-5 text-graphite">
          Upload prescriptions, lab reports, or discharge summaries. Files are retained securely in your vault.
        </p>

        <div className="mt-4 space-y-3.5">
          <div>
            <label htmlFor="docType" className="font-sans text-xs font-semibold text-graphite">
              Document type
            </label>
            <select
              id="docType"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="clinix-field mt-1 font-sans text-sm"
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="fileInput" className="font-sans text-xs font-semibold text-graphite">
              Select file (PNG, JPG, PDF)
            </label>
            <input
              id="fileInput"
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full rounded-xl border border-sage bg-canvas p-2.5 font-sans text-xs text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-botanical file:px-3 file:py-1.5 file:font-sans file:text-xs file:font-semibold file:text-surface"
            />
          </div>

          <button
            type="button"
            onClick={upload}
            disabled={uploading || !file}
            className="min-h-[50px] w-full rounded-2xl bg-botanical px-4 font-sans text-xs font-bold uppercase tracking-wider text-surface transition-transform active:translate-y-px disabled:opacity-50"
          >
            {uploading ? "Encrypting & uploading…" : "Upload to vault"}
          </button>
        </div>

        {uploadError && (
          <p role="alert" className="mt-3 font-sans text-xs font-medium text-critical">
            {uploadError}
          </p>
        )}
      </section>

      {/* Document shelf (Figma 25:2) */}
      <section className="clinix-card p-5">
        <div className="flex items-center justify-between border-b border-hairline pb-3">
          <div>
            <p className="clinix-label text-botanical">Vault archive</p>
            <h2 className="mt-0.5 font-sans text-lg font-bold text-ink">Recent documents</h2>
          </div>
          {docs.status === "ready" && (
            <span className="font-mono text-xs text-graphite">{docs.data.length} files</span>
          )}
        </div>

        {docs.status === "loading" && <Skeleton className="mt-3 h-28 rounded-2xl" />}
        {docs.status === "error" && <p className="mt-3 font-sans text-sm text-critical">{docs.error}</p>}
        {docs.status === "ready" && docs.data.length === 0 && (
          <p className="mt-4 font-sans text-xs text-graphite">No documents in your vault yet.</p>
        )}
        {docs.status === "ready" && docs.data.length > 0 && (
          <ul className="mt-3 divide-y divide-hairline">
            {docs.data.map((d) => (
              <li key={d.document_id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-sans text-sm font-semibold text-ink">{d.original_filename}</p>
                  <p className="mt-0.5 font-sans text-xs text-graphite">{d.document_type.replace(/_/g, " ")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={d.processing_status} />
                  <button
                    type="button"
                    onClick={() => viewSource(d.document_id)}
                    className="min-h-9 rounded-xl border border-sage bg-surface px-3 font-sans text-xs font-semibold text-botanical hover:bg-canvas"
                  >
                    View
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Extracted Lab results */}
      <section className="clinix-card p-5">
        <div className="flex items-center justify-between border-b border-hairline pb-3">
          <div>
            <p className="clinix-label text-botanical">Extracted observations</p>
            <h2 className="mt-0.5 font-sans text-lg font-bold text-ink">Lab reports & values</h2>
          </div>
          {reports.status === "ready" && (
            <span className="font-mono text-xs text-graphite">{reports.data.length} reports</span>
          )}
        </div>

        {reports.status === "loading" && <Skeleton className="mt-3 h-32 rounded-2xl" />}
        {reports.status === "error" && <p className="mt-3 font-sans text-sm text-critical">{reports.error}</p>}
        {reports.status === "ready" && reports.data.length === 0 && (
          <p className="mt-4 font-sans text-xs text-graphite">No extracted lab reports yet.</p>
        )}
        {reports.status === "ready" && reports.data.length > 0 && (
          <>
            <div className="mt-3">
              <label htmlFor="reportSelect" className="font-sans text-xs text-graphite">Select report</label>
              <select
                id="reportSelect"
                value={reportIdx}
                onChange={(e) => setReportIdx(Number(e.target.value))}
                className="clinix-field mt-1 font-sans text-sm"
              >
                {reports.data.map((r, i) => (
                  <option key={r.report_id} value={i}>
                    {r.laboratory_name ?? "Lab report"} · {r.collection_date ?? "undated"}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 space-y-3">
              {reports.data[reportIdx]?.observations.map((o) => (
                <div key={o.id} className="rounded-2xl border border-hairline bg-canvas p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-sans text-sm font-semibold text-ink">{o.test_name}</p>
                      <p className="mt-0.5 font-mono text-sm font-bold text-botanical">
                        {o.value_numeric != null ? `${o.value_numeric}${o.unit ? ` ${o.unit}` : ""}` : o.value_text ?? "—"}
                        {o.flag && (
                          <span className="ml-2 font-sans text-xs font-semibold text-critical">
                            ({o.flag})
                          </span>
                        )}
                      </p>
                    </div>
                    <ConfidenceBadge value={o.confidence} />
                  </div>
                  {o.reference_text && (
                    <p className="mt-1 font-sans text-xs text-graphite">Reference range: {o.reference_text}</p>
                  )}

                  {o.needs_review && (
                    <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5">
                      <input
                        type="text"
                        defaultValue={o.value_numeric != null ? fmtNum(o.value_numeric) : o.value_text ?? ""}
                        className="h-9 w-28 rounded-xl border border-sage bg-surface px-2.5 font-mono text-xs text-ink"
                      />
                      <button
                        type="button"
                        disabled={confirming === o.id}
                        onClick={(e) =>
                          void confirmObservation(
                            o.id,
                            (e.currentTarget.previousElementSibling as HTMLInputElement).value,
                          )
                        }
                        className="min-h-9 rounded-xl bg-copper px-3 font-sans text-xs font-bold uppercase text-ink disabled:opacity-60"
                      >
                        Confirm value
                      </button>
                    </div>
                  )}
                  {o.confirmed_at && (
                    <p className="mt-2 font-sans text-[11px] font-semibold text-botanical">✓ Confirmed</p>
                  )}
                </div>
              ))}
            </div>

            {/* Longitudinal Trend section */}
            <div className="mt-6 border-t border-hairline pt-4">
              <p className="clinix-label text-botanical">Longitudinal trend</p>
              <select
                value={trendTest ?? ""}
                onChange={(e) => setTrendTest(e.target.value || null)}
                className="clinix-field mt-2 font-sans text-sm"
              >
                <option value="">Select a measurement to view trend…</option>
                {allTestNames.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {trend.status === "ready" && (
                <div className="mt-4">
                  <Sparkline points={trend.data.points} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Source preview drawer (Node 25:3) */}
      {drawer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-source-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4"
          onClick={() => setDrawer(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-[2rem] border border-sage bg-surface p-6 shadow-2xl sm:rounded-[2rem]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="rounded-full border border-sage px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-botanical">
                  Original source
                </span>
                <h3 id="drawer-source-title" className="mt-1 font-sans text-lg font-bold text-ink">
                  {drawer.original_filename}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                aria-label="Close source preview"
                className="grid size-9 place-items-center rounded-full border border-sage bg-canvas text-ink"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] overflow-auto rounded-2xl bg-canvas p-3">
              {drawer.view_url && drawer.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={drawer.view_url} alt={drawer.original_filename} className="w-full rounded-xl" />
              ) : drawer.view_url ? (
                <a
                  href={drawer.view_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-sans text-sm font-semibold text-copper hover:underline"
                >
                  Open full document in new window →
                </a>
              ) : (
                <p className="font-sans text-xs text-graphite">Source preview unavailable.</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="mt-5 min-h-12 w-full rounded-2xl bg-botanical font-sans text-sm font-semibold text-surface"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
