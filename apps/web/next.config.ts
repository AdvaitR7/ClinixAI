import path from "node:path";
import type { NextConfig } from "next";

const mobileExport = process.env.CLINIX_MOBILE_EXPORT === "1";

const nextConfig: NextConfig = {
  // Keep browser acceptance builds isolated from an already running developer server.
  distDir: process.env.CLINIX_TEST_DIST_DIR ?? ".next",
  transpilePackages: ["@clinix/schemas"],
  // Self-contained server bundle for the Docker image; the tracing root is the repo root so workspace packages are included.
  output: mobileExport ? "export" : "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  ...(mobileExport
    ? { images: { unoptimized: true } }
    : {
        async headers() {
          return [
            {
              // The service worker must never be served from an HTTP cache, or updates would be delayed.
              source: "/sw.js",
              headers: [
                { key: "Content-Type", value: "application/javascript; charset=utf-8" },
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
