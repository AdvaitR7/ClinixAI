import type { ReactNode } from "react";
import { RequireWorkspace } from "@/components/route-guards";

/** Requires a supported database-owned application role for settings. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <RequireWorkspace>{children}</RequireWorkspace>;
}
