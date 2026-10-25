import type { ReactNode } from "react";
import { RequireWorkspace } from "@/components/route-guards";

/** Keeps patient routes behind the database-resolved patient role. */
export default function PatientLayout({ children }: { children: ReactNode }) {
  return <RequireWorkspace role="PATIENT">{children}</RequireWorkspace>;
}
