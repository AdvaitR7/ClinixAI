import type { ReactNode } from "react";
import { RequireWorkspace } from "@/components/route-guards";

/** Keeps staff routes behind the database-resolved staff role. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <RequireWorkspace role="CLINIC_STAFF">{children}</RequireWorkspace>;
}
