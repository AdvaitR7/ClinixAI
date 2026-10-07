import { createElement } from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export interface PrescriptionPdfData {
  doctorName: string;
  doctorSpeciality: string | null;
  doctorRegistration: string;
  patientName: string;
  finalizedAt: string;
  versionNumber: number;
  items: {
    medicine_name: string;
    strength: string | null;
    dose: string | null;
    route: string | null;
    frequency: string | null;
    timing: string | null;
    duration: string | null;
    instructions: string | null;
  }[];
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica" },
  header: { marginBottom: 20 },
  clinic: { fontSize: 20, fontWeight: "bold", color: "#12352C" },
  sub: { fontSize: 10, color: "#3D4640", marginTop: 2 },
  row: { fontSize: 11, marginBottom: 4, color: "#151919" },
  table: { marginTop: 16 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#12352C",
    paddingBottom: 6,
    marginBottom: 6,
  },
  th: { fontSize: 9, fontWeight: "bold", color: "#3D4640" },
  item: { flexDirection: "row", marginBottom: 6, fontSize: 10, color: "#151919" },
  footer: {
    marginTop: 28,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E6E0D6",
    fontSize: 9,
    color: "#3D4640",
  },
  med: { width: "30%" },
  strength: { width: "15%" },
  dose: { width: "15%" },
  freq: { width: "20%" },
  duration: { width: "20%" },
});

/** Renders a finalized prescription to PDF bytes (API §25). No JSX in the API service. */
export async function renderPrescriptionPdf(data: PrescriptionPdfData): Promise<Buffer> {
  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { style: styles.page, size: "A4" },
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.clinic }, "CliniX — Prescription"),
        createElement(Text, { style: styles.sub }, `Dr. ${data.doctorName}${data.doctorSpeciality ? ` · ${data.doctorSpeciality}` : ""}`),
        createElement(Text, { style: styles.sub }, `Registration: ${data.doctorRegistration}`),
      ),
      createElement(Text, { style: styles.row }, `Patient: ${data.patientName}`),
      createElement(
        Text,
        { style: styles.row },
        `Finalized: ${new Date(data.finalizedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · Version ${data.versionNumber}`,
      ),
      createElement(
        View,
        { style: styles.table },
        createElement(
          View,
          { style: styles.tableHeader },
          createElement(Text, { style: [styles.th, styles.med] }, "Medicine"),
          createElement(Text, { style: [styles.th, styles.strength] }, "Strength"),
          createElement(Text, { style: [styles.th, styles.dose] }, "Dose"),
          createElement(Text, { style: [styles.th, styles.freq] }, "Frequency"),
          createElement(Text, { style: [styles.th, styles.duration] }, "Duration"),
        ),
        ...data.items.map((it) =>
          createElement(
            View,
            { style: styles.item, key: `${it.medicine_name}-${it.strength ?? ""}` },
            createElement(Text, { style: styles.med }, it.medicine_name),
            createElement(Text, { style: styles.strength }, it.strength ?? ""),
            createElement(Text, { style: styles.dose }, it.dose ?? ""),
            createElement(Text, { style: styles.freq }, [it.frequency, it.timing].filter(Boolean).join(" ")),
            createElement(Text, { style: styles.duration }, it.duration ?? ""),
          ),
        ),
      ),
      createElement(
        Text,
        { style: styles.footer },
        "Computer-generated prescription — CliniX. Verify with the prescribing doctor before use.",
      ),
    ),
  );
  return renderToBuffer(doc);
}
