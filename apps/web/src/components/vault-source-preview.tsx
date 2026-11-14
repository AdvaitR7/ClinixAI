"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentView, LabReportView } from "@clinix/schemas";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createIdentityRequest } from "@/lib/auth";
import { useApiData } from "@/lib/api";

/** Renders actual PDF bytes and page count locally; no document data goes to an external viewer. */
function PdfPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(270);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [rendering, setRendering] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    const controller = new AbortController();
    const request = createIdentityRequest(controller.signal);
    /** Loads the browser-only PDF engine only when a patient opens a PDF source. */
    async function load() {
      try {
        const engine = await import("pdfjs-dist");
        if (!active) return;
        engine.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const response = await fetch(url, { signal: request.signal, credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("The source could not be loaded. Reopen it to refresh access.");
        const data = new Uint8Array(await response.arrayBuffer());
        if (!active) return;
        task = engine.getDocument({ data });
        const document = await task.promise;
        if (active) { setPdf(document); setError(null); }
      } catch (cause) {
        if (active && !request.signal.aborted) setError(cause instanceof Error ? cause.message : "PDF preview unavailable.");
      } finally { request.release(); }
    }
    void load();
    return () => { active = false; controller.abort(); request.release(); void task?.destroy(); };
  }, [url, retry]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    /** Cancels the previous canvas render before displaying another source page. */
    async function render() {
      setRendering(true);
      setText("");
      try {
        const sourcePage = await pdf!.getPage(page);
        if (!active || !canvasRef.current) return;
        const viewport = sourcePage.getViewport({ scale: width / sourcePage.getViewport({ scale: 1 }).width });
        const canvas = canvasRef.current;
        const scale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * scale);
        canvas.height = Math.floor(viewport.height * scale);
        task = sourcePage.render({ canvas, viewport, transform: [scale, 0, 0, scale, 0, 0] });
        await task.promise;
        const content = await sourcePage.getTextContent();
        if (active) { setText(content.items.map((item) => "str" in item ? item.str : "").join(" ")); setError(null); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Page preview unavailable.");
      } finally { if (active) setRendering(false); }
    }
    void render();
    return () => { active = false; task?.cancel(); };
  }, [pdf, page, width]);

  return <>
    <div ref={containerRef} className="min-h-56 overflow-hidden rounded-[20px] bg-canvas p-3">
      {!pdf && !error && <p role="status" className="py-12 text-center text-xs">Loading original PDF…</p>}
      {error ? <div role="alert" className="space-y-3 py-6 text-xs text-critical"><p>{error}</p><button type="button" onClick={() => { setPdf(null); setRetry((value) => value + 1); setError(null); }} className="min-h-11 underline">Retry PDF preview</button></div> : null}
      <canvas ref={canvasRef} role="img" aria-label={`Original PDF page ${page}`} className={`h-auto w-full rounded-xl bg-white ${!pdf || rendering || error ? "hidden" : ""}`} />
      {pdf && rendering && !error && <p role="status" className="py-12 text-center text-xs">Rendering page {page}…</p>}
      <p className="sr-only">{text}</p>
    </div>
    <div className="mt-2 flex items-center justify-between text-xs text-graphite">
      <span aria-live="polite">{pdf ? `Page ${page} of ${pdf.numPages}` : "Page count unavailable"}</span>
      <div className="flex gap-2">
        <button type="button" aria-label="Previous source page" disabled={!pdf || page === 1 || rendering} onClick={() => setPage((value) => value - 1)} className="size-11 text-xl text-botanical disabled:opacity-30">←</button>
        <button type="button" aria-label="Next source page" disabled={!pdf || page === pdf.numPages || rendering} onClick={() => setPage((value) => value + 1)} className="size-11 text-xl text-botanical disabled:opacity-30">→</button>
      </div>
    </div>
  </>;
}

/** Loads a freshly authorized source and connects it to its actual extracted report. */
export function VaultSourcePreview({ documentId, reports, onClose, onObservations }: {
  documentId: string;
  reports: LabReportView[];
  onClose: () => void;
  onObservations: (reportId: string) => void;
}) {
  const source = useApiData<DocumentView>(`/patients/self/documents/${encodeURIComponent(documentId)}`);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const downloadRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { downloadRequest.current?.abort(); }, []);
  const report = reports.find((item) => item.source_document_id === documentId);
  const doc = source.status === "ready" ? source.data : null;

  /** Saves the original bytes with their filename, checking storage failures before creating a download. */
  async function download() {
    if (!doc?.view_url || downloadRequest.current) return;
    const controller = new AbortController();
    const request = createIdentityRequest(controller.signal);
    downloadRequest.current = controller;
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(doc.view_url, { signal: request.signal, credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("Download failed. Reopen the source to refresh access.");
      const blob = await response.blob();
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.original_filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!request.signal.aborted) setDownloadError(cause instanceof Error ? cause.message : "Download failed.");
    } finally {
      request.release();
      downloadRequest.current = null;
      if (!request.signal.aborted) setDownloading(false);
    }
  }

  return <>
    <div className="flex items-start justify-between gap-3">
      <p className="pt-2 text-xs tracking-wider text-botanical">SOURCE PREVIEW</p>
      <button type="button" aria-label="Close source preview" onClick={onClose} className="grid size-11 shrink-0 place-items-center text-2xl text-graphite">×</button>
    </div>
    <h2 id="vault-dialog-title" className="break-words text-[21px] font-normal">{doc?.original_filename ?? "Original source"}</h2>
    {source.status === "loading" && <p role="status" className="py-8 text-sm">Loading source…</p>}
    {source.status === "error" && <div role="alert" className="my-4 text-xs text-critical"><p>{source.error}</p><button type="button" onClick={() => void source.refresh()} className="min-h-11 underline">Retry source</button></div>}
    {doc && <>
      <p className="mt-1 text-xs text-graphite">{report?.laboratory_name ? `${report.laboratory_name} · ` : ""}{new Date(doc.created_at).toLocaleDateString("en-GB")} · {doc.mime_type === "application/pdf" ? "PDF" : "Image"}</p>
      <p className="mb-4 mt-3 inline-block rounded-full border border-hairline bg-canvas px-5 py-1.5 text-xs text-botanical">ORIGINAL SOURCE</p>
      {imageError && <p role="alert" className="mb-3 text-xs text-critical">Image preview unavailable. <button type="button" className="min-h-11 underline" onClick={() => { setImageError(false); void source.refresh(); }}>Retry image preview</button></p>}
      {doc.view_url ? doc.mime_type === "application/pdf" ? <PdfPreview key={doc.view_url} url={doc.view_url} /> : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={doc.view_url} alt={doc.original_filename} onError={() => setImageError(true)} className="h-auto w-full rounded-[20px] bg-canvas p-3" />
      ) : <p className="py-6 text-xs">Source preview unavailable.</p>}
      <p className="mb-2 mt-6 text-xs tracking-wider text-botanical">EXTRACTION PROVENANCE</p>
      <div className="rounded-2xl border border-hairline p-4 text-xs shadow-sm">
        <p>{doc.processing_status === "NEEDS_REVIEW" ? "OCR complete · needs review" : doc.processing_status === "COMPLETE" ? (["LAB_REPORT", "PRESCRIPTION"].includes(doc.document_type) ? "OCR complete" : "Source stored") : doc.processing_status.replaceAll("_", " ")}</p>
        <p className="mt-2 text-xs text-graphite">{report ? `${report.observations.length} observations extracted` : "No lab observations available"}</p>
        {report && <button type="button" onClick={() => onObservations(report.report_id)} className="mt-1 min-h-11 text-left text-xs text-botanical">View extracted observations →</button>}
      </div>
      {doc.view_url && <a href={doc.view_url} target="_blank" rel="noreferrer" className="mt-5 flex min-h-12 items-center justify-center rounded-2xl bg-botanical px-3 text-center text-xs text-surface">OPEN ORIGINAL {doc.mime_type === "application/pdf" ? "PDF" : "IMAGE"}</a>}
      <div className="mt-1 flex items-center gap-4 text-xs">
        <button type="button" onClick={() => void download()} disabled={!doc.view_url || downloading} className="min-h-11 shrink-0 text-botanical disabled:opacity-50">{downloading ? "Downloading…" : "Download source"}</button>
        <p className="text-xs text-graphite">This preview never replaces the original file.</p>
      </div>
      {downloadError && <p role="alert" className="text-xs text-critical">{downloadError}</p>}
    </>}
  </>;
}
