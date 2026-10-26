import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep browser acceptance builds isolated from an already running developer server.
  distDir: process.env.CLINIX_TEST_DIST_DIR ?? ".next",
  transpilePackages: ["@clinix/schemas"],
};

export default nextConfig;
