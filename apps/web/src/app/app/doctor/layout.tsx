import type { ReactNode } from "react";
import { RequireWorkspace } from "@/components/route-guards";

/** Keeps doctor routes behind the database-resolved doctor role. */
export default function DoctorLayout({ children }: { children: ReactNode }) {
  return <RequireWorkspace role="DOCTOR">{children}</RequireWorkspace>;
}
