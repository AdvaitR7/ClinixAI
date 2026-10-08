"use client";

import { useAuth } from "@clerk/nextjs";
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

/** Inline SVG trend sparkline (hand-rolled, no chart dep). */
function Sparkline({ points }: { points: LabTrendPoint[] }) {
  if (points.length === 0) return <p className="font-sans text-xs text-graphite">No trend data.</p>;
  const w = 300;
  const h = 80;
  const pad = 6;
  const vals = points.map((p) => p.value_numeric);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(points.length - 1, 1);
    const y = h - pad - ((p.value_numeric - min) / range) * (h - 2 * pad);
    return { x, y, low: p.confidence != null && p.confidence < 0.85 };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" role="img" aria-label="Lab value trend">
      <polyline
        fill="none"
        stroke="#12352c"
        strokeWidth="2"
        points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
      />
      {coords
        .filter((c) => c.low)
        .map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="3" fill="#a65f11" />
        ))}
    </svg>
  );
}

/** Page 9 — Health Vault & Document Hub (SCREEN_CATALOG §7). */
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
      {/* Upload */}
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          Upload a document
        </p>
        <div className="mt-3 space-y-3">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full rounded-full border border-hairline bg-surface px-4 py-2 font-sans text-sm"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full font-sans text-sm"
          />
          <button
            type="button"
            onClick={upload}
            disabled={uploading || !file}
            className="w-full rounded-full bg-botanical px-4 py-2 font-sans text-sm font-semibold text-surface disabled:opacity-60"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadError && (
          <p role="alert" className="mt-2 font-sans text-sm font-medium text-critical">
            {uploadError}
          </p>
        )}
      </section>

      {/* Document shelf */}
      <section>
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          Documents
        </p>
        {docs.status === "loading" && <Skeleton className="mt-3 h-20 rounded-2xl" />}
        {docs.status === "error" && (
          <p className="mt-3 font-sans text-sm text-critical">{docs.error}</p>
        )}
        {docs.status === "ready" &&
          (docs.data.length === 0 ? (
            <p className="mt-3 font-sans text-sm text-graphite">No documents yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {docs.data.map((d) => (
                <li
                  key={d.document_id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-sans text-sm font-semibold">{d.original_filename}</p>
                    <p className="mt-1 font-sans text-xs text-graphite">{d.document_type}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={d.processing_status} />
                    <button
                      type="button"
                      onClick={() => viewSource(d.document_id)}
                      className="rounded-full border border-hairline px-3 py-1 font-sans text-xs font-semibold text-botanical"
                    >
                      View source
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>

      {/* Lab observations */}
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          Lab results
        </p>
        {reports.status === "ready" && reports.data.length === 0 && (
          <p className="mt-2 font-sans text-sm text-graphite">No lab reports extracted yet.</p>
        )}
        {reports.status === "ready" && reports.data.length > 0 && (
          <>
            <select
              value={reportIdx}
              onChange={(e) => setReportIdx(Number(e.target.value))}
              className="mt-3 w-full rounded-full border border-hairline bg-surface px-4 py-2 font-sans text-sm"
            >
              {reports.data.map((r, i) => (
                <option key={r.report_id} value={i}>
                  {r.laboratory_name ?? "Lab report"} · {r.collection_date ?? "no date"}
                </option>
              ))}
            </select>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left font-sans text-sm">
                <thead>
                  <tr className="text-xs text-graphite">
                    <th className="pr-3 font-semibold">Test</th>
                    <th className="pr-3 font-semibold">Value</th>
                    <th className="pr-3 font-semibold">Reference</th>
                    <th className="pr-3 font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.data[reportIdx]?.observations.map((o) => (
                    <tr key={o.id} className="border-t border-hairline align-top">
                      <td className="py-2 pr-3 font-medium">{o.test_name}</td>
                      <td className="py-2 pr-3">
                        {o.value_numeric != null
                          ? `${o.value_numeric}${o.unit ? ` ${o.unit}` : ""}`
                          : o.value_text ?? "—"}
                        {o.flag && (
                          <span className="ml-2 font-sans text-xs font-semibold text-critical">
                            {o.flag}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-graphite">{o.reference_text ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col items-start gap-1">
                          <ConfidenceBadge value={o.confidence} />
                          {o.needs_review && (
                            <span className="flex items-center gap-2">
                              <input
                                type="text"
                                defaultValue={o.value_numeric != null ? fmtNum(o.value_numeric) : o.value_text ?? ""}
                                className="w-24 rounded-full border border-hairline px-3 py-1 font-sans text-xs"
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
                                className="rounded-full bg-copper px-3 py-1 font-sans text-xs font-semibold text-botanical disabled:opacity-60"
                              >
                                Confirm
                              </button>
                            </span>
                          )}
                          {o.confirmed_at && (
                            <span className="font-sans text-xs text-botanical">Confirmed</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Trend sparkline */}
            <div className="mt-5 border-t border-hairline pt-4">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
                Trend
              </p>
              <select
                value={trendTest ?? ""}
                onChange={(e) => setTrendTest(e.target.value || null)}
                className="mt-2 w-full rounded-full border border-hairline bg-surface px-4 py-2 font-sans text-sm"
              >
                <option value="">Select a test…</option>
                {allTestNames.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {trend.status === "ready" && (
                <div className="mt-3">
                  <Sparkline points={trend.data.points} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Source drawer */}
      {drawer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6"
          onClick={() => setDrawer(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="font-sans text-sm font-semibold">{drawer.original_filename}</p>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                className="rounded-full border border-hairline px-3 py-1 font-sans text-xs font-semibold text-graphite"
              >
                Close
              </button>
            </div>
            <div className="mt-4">
              {drawer.view_url && drawer.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={drawer.view_url} alt={drawer.original_filename} className="w-full rounded-xl" />
              ) : drawer.view_url ? (
                <a
                  href={drawer.view_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-sans text-sm font-semibold text-copper"
                >
                  Open document →
                </a>
              ) : (
                <p className="font-sans text-sm text-graphite">Preview unavailable.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
