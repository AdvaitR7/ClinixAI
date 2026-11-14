// @ts-check
import fs from "node:fs";
import path from "node:path";

/**
 * Writes public/.well-known/assetlinks.json so Android App Links (the auth callback) open the
 * CliniX APK instead of the browser.
 *
 * Reads ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT (comma-separated release certificate SHA-256
 * fingerprints). When it is unset, nothing is written, matching the Docker build. Run from apps/web
 * before `next build` (the Vercel build command does this).
 */
function writeAssetLinks() {
  const raw = process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT ?? "";
  const fingerprints = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (fingerprints.length === 0) {
    console.log("assetlinks: ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT unset, skipping");
    return;
  }
  const dir = path.join("public", ".well-known");
  fs.mkdirSync(dir, { recursive: true });
  const statement = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "com.clinixai.app", sha256_cert_fingerprints: fingerprints },
    },
  ];
  fs.writeFileSync(path.join(dir, "assetlinks.json"), JSON.stringify(statement));
  console.log(`assetlinks: wrote ${fingerprints.length} fingerprint(s)`);
}

writeAssetLinks();
