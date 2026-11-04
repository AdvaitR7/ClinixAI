import { defineConfig, devices } from "@playwright/test";

// Lets context.route() see requests made by the service worker, so caching of API traffic can be tested for real.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

/**
 * Production PWA acceptance: `next build && next start` on :3200, driven with phone profiles.
 * Production requires HTTPS API and Supabase origins, so the build uses synthetic https hosts that the
 * specs intercept; nothing here contacts a real service.
 * Only Chromium is installed here, so the iPhone 14 profile is a Chromium emulation of its viewport and UA, not WebKit.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa.spec.ts",
  use: { baseURL: "http://127.0.0.1:3200" },
  projects: [
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
    { name: "iphone-14-emulated", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run build && npx next start --hostname 127.0.0.1 --port 3200",
    url: "http://127.0.0.1:3200/sign-in",
    reuseExistingServer: false,
    timeout: 480_000,
    env: {
      CLINIX_TEST_DIST_DIR: ".next-pwa-tests",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.clinix.test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
      NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL: "https://app.clinix.test",
      NEXT_PUBLIC_API_BASE_URL: "https://api.clinix.test/api/v1",
    },
  },
});
