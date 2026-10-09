import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

const appearance = {
  elements: {
    rootBox: "mx-0 w-full",
    cardBox: "w-full shadow-none",
    card: "w-full gap-5 bg-transparent p-0 shadow-none",
    header: "hidden",
    main: "gap-5",
    form: "gap-5",
    formField: "gap-2",
    formFieldLabel: "font-sans text-sm font-medium text-ink",
    formFieldInput:
      "min-h-[54px] rounded-2xl border border-sage bg-surface px-4 font-sans text-sm text-ink shadow-none focus:border-botanical focus:ring-1 focus:ring-botanical",
    formButtonPrimary:
      "min-h-[57px] rounded-[18px] bg-botanical font-sans text-sm font-bold uppercase text-surface shadow-[0_5px_14px_rgba(18,53,44,0.14)] hover:bg-botanical focus:bg-botanical",
    socialButtonsBlockButton:
      "min-h-[52px] rounded-[15px] border border-sage bg-surface text-ink shadow-none hover:bg-surface",
    dividerLine: "bg-sage",
    dividerText: "font-sans text-xs text-graphite",
    footer: "bg-transparent px-0 pt-3",
    footerActionText: "font-sans text-xs text-graphite",
    footerActionLink: "font-sans text-xs font-semibold uppercase text-evidence",
    identityPreview: "rounded-2xl border border-sage bg-surface",
    formFieldAction: "text-xs font-semibold uppercase text-evidence",
    formFieldErrorText: "font-sans text-xs text-critical",
    alertText: "font-sans text-sm text-critical",
    footerPages: "hidden",
  },
};

/** Page 1 — Login (SCREEN_CATALOG §7). Routes to the default workspace after. */
export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="Secure access"
      title="Sign in"
      orientation="Give your credentials to sign in to your account."
    >
      <div className="mb-6 flex rounded-2xl border border-sage bg-canvas p-1" role="tablist" aria-label="Authentication modes">
        <span
          role="tab"
          aria-selected="true"
          className="flex-1 rounded-xl bg-botanical py-2.5 text-center font-sans text-xs font-bold uppercase tracking-wider text-surface shadow-sm"
        >
          Sign in
        </span>
        <Link
          href="/sign-up"
          role="tab"
          aria-selected="false"
          className="flex-1 rounded-xl py-2.5 text-center font-sans text-xs font-semibold uppercase tracking-wider text-graphite hover:text-ink"
        >
          Sign up
        </Link>
      </div>
      <SignIn
        forceRedirectUrl="/after-sign-in"
        signUpUrl="/sign-up"
        appearance={appearance}
      />
      <div className="mt-5 grid grid-cols-3 gap-4" aria-label="Unavailable sign-in providers">
        {[
          ["f", "Facebook"],
          ["G", "Google"],
          ["●", "Apple"],
        ].map(([mark, label]) => (
          <button
            key={label}
            type="button"
            disabled
            title={`${label} sign in is unavailable`}
            className="min-h-[52px] rounded-[15px] border border-sage bg-surface font-sans text-lg font-bold text-graphite opacity-45"
          >
            <span aria-hidden="true">{mark}</span>
            <span className="sr-only">{label} sign in unavailable</span>
          </button>
        ))}
      </div>
    </AuthShell>
  );
}
