import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3100", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/sign-in",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
      NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL: "http://127.0.0.1:3100",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4000/api/v1",
    },
    timeout: 120_000,
  },
});
