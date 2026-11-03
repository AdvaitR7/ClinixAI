import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { InstallPromptCapture } from "@/components/install-app";
import { AuthProvider } from "@/lib/auth";
import { SerwistProvider } from "./serwist";
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
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CliniX" },
  formatDetection: { telephone: false },
  icons: { apple: "/icons/apple-180.png" },
};

// Pinch zoom stays enabled for accessibility; viewport-fit covers the notch for safe-area insets.
export const viewport: Viewport = {
  themeColor: "#12352C",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jbmono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === "development"}>
          <InstallPromptCapture />
          <AuthProvider>
            {children}
          </AuthProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
