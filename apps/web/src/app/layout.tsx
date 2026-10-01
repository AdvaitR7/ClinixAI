import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = {
  title: "CliniX AI",
  description:
    "Privacy-first personal health record and clinical workflow platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jbmono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#12352c",
              colorNeutral: "#151919",
              colorBackground: "#fffdfc",
              colorInput: "#fffdfc",
              colorInputForeground: "#151919",
              colorBorder: "#e6e0d6",
              borderRadius: "0.75rem",
              fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
