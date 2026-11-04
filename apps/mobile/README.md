# CliniX Android app

The Capacitor app bundles the statically exported UI. It connects to the configured HTTPS API; records, uploads, and AI features need a network connection. No 9Router or Supabase service-role credentials are included in the APK.

## Build a debug APK

Use JDK 21 and an installed Android SDK. The web export reads the public app configuration from environment variables:

```bash
export NEXT_PUBLIC_API_BASE_URL=https://api.<domain>/api/v1
export NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
export NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL=https://app.<domain>
npm run build:android
```

The APK is written to `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

## Signed release

The GitHub Actions workflow `.github/workflows/android-release.yml` builds and publishes signed APKs. Configure the Android keystore values as repository secrets and keep a separate encrypted backup of the original keystore. Set `CLINIX_AUTH_HOST` to the app web domain hostname and the same public web configuration used for Dokploy. The certificate fingerprint in `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT` must match the release signing key for Android App Links.

Releases stay in the PRIVATE `AdvaitR7/ClinixAI` repository. Download through a browser signed into GitHub with repository access. No GitHub credential is embedded in the app. Published candidates are prereleases until physical-phone acceptance.

The encrypted signing-keystore backup created during setup is `/home/advait/.local/share/clinix-signing/clinix-release.jks`; copy it to a second safe location outside the VPS and preserve its password.

Each release has an increasing version code and publishes a SHA-256 checksum. Install the newer APK over an existing install to verify the signing key and retained session behavior.

## Authentication and offline behavior

Email confirmation and recovery callbacks use verified HTTPS App Links on the `app.<domain>` hostname. Keep that hostname in the Supabase Auth redirect allow-list and serve the generated `/.well-known/assetlinks.json` file from the same web origin.

The bundled UI opens without network access and shows a connection notice. Patient data, edits, uploads, and AI work require connectivity. No clinical data is cached for offline use.
