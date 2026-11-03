import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The deployed web origin the app loads, e.g. https://app.example.com.
 * Required at `cap sync` time so a build can never silently ship without a target.
 */
const appUrl = process.env.CLINIX_APP_URL?.trim();
if (!appUrl) throw new Error("Set CLINIX_APP_URL to the deployed web origin before running cap sync.");
if (!appUrl.startsWith("https://")) throw new Error("CLINIX_APP_URL must be an https:// origin.");

/** Extra hosts the WebView may navigate to inside the app (the Supabase project, for auth redirects). */
const allowNavigation = (process.env.CLINIX_ALLOW_NAVIGATION ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

// `server.url` makes this a thin shell around the live site. Capacitor documents it as intended for
// development; it is used here deliberately so web deploys reach installed apps without a new APK.
const config: CapacitorConfig = {
  appId: "com.clinixai.app",
  appName: "CliniX",
  // Holds only the bundled offline page; real screens come from server.url.
  webDir: "www",
  // Lets the web app recognise the shell instantly (see NATIVE_USER_AGENT_MARKER in apps/web/src/lib/native.ts).
  appendUserAgent: "CliniXApp",
  server: {
    url: appUrl,
    cleartext: false,
    errorPath: "offline.html",
    allowNavigation,
  },
  android: {
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
};

export default config;
