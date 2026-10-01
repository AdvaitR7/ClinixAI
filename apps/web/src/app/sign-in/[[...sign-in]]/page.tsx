import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

/** Page 1 — Login (SCREEN_CATALOG §7). Routes to the default workspace after. */
export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="CliniX"
      title="Welcome back"
      orientation="Sign in to open your workspace. Your health record stays private to you."
    >
      <SignIn
        forceRedirectUrl="/after-sign-in"
        signUpUrl="/sign-up"
        appearance={{ elements: { rootBox: "mx-0 w-full", cardBox: "w-full shadow-none" } }}
      />
    </AuthShell>
  );
}
