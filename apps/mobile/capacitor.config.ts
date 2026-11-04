import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.clinixai.app",
  appName: "CliniX",
  webDir: process.env.CLINIX_MOBILE_WEB_DIR?.trim() || "www",
  // Lets the web app recognise the shell instantly (see NATIVE_USER_AGENT_MARKER in apps/web/src/lib/native.ts).
  appendUserAgent: "CliniXApp",
  android: {
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
};

export default config;
