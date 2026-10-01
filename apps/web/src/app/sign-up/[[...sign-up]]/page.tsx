import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

/** Page 2 — Signup (SCREEN_CATALOG §7). New accounts continue to role select. */
export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="CliniX"
      title="Create your account"
      orientation="One CliniX account holds your workspaces. CliniX is for adults aged 18 and over, for non-emergency care."
    >
      <SignUp
        forceRedirectUrl="/onboarding/role"
        signInUrl="/sign-in"
        appearance={{ elements: { rootBox: "mx-0 w-full", cardBox: "w-full shadow-none" } }}
      />
    </AuthShell>
  );
}
