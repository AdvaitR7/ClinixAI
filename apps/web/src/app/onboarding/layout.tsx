import type { ReactNode } from "react";
import { RequireOnboarding } from "@/components/route-guards";

/** Shows role onboarding only for verified accounts without an app profile. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <RequireOnboarding>{children}</RequireOnboarding>;
}
