import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { InstallPromptCapture } from "@/components/install-app";
import { NativeShell } from "@/components/native-shell";
import { AuthProvider } from "@/lib/auth";
import { SerwistProvider } from "./serwist";
import "./globals.css";

// Single global Inter source for the whole app.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = {
  title: "CliniX AI",
  description:
    "Privacy-first personal health record and clinical workflow platform.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "CliniX" },
  formatDetection: { telephone: false },
  icons: { apple: "/icons/apple-180.png" },
};

// Pinch zoom stays enabled for accessibility; viewport-fit covers the notch for safe-area insets.
export const viewport: Viewport = {
  themeColor: "#F2F6F6",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`}>
      <body data-ui="clear" className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_MOBILE_BUNDLE === "1"}>
          <InstallPromptCapture />
          <NativeShell />
          <AuthProvider>
            {children}
          </AuthProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
