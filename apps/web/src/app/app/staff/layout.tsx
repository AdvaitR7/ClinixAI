import type { ReactNode } from "react";
import { RequireStaffWorkspace } from "@/components/route-guards";

/** Keeps staff routes behind an active practice membership resolved by the API. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <RequireStaffWorkspace>{children}</RequireStaffWorkspace>;
}
