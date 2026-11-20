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

Build and sign your own APK using the [deployment guide](../../docs/operations/deployment.md). Keep the keystore and its encrypted backup outside the repository. Set `CLINIX_AUTH_HOST` to your web hostname and configure `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT` to match your signing certificate.

Increment the version code for updates. Verify an upgrade on a physical device before distributing the APK.

## Authentication and offline behavior

Email confirmation and recovery callbacks use verified HTTPS App Links on the `app.<domain>` hostname. Keep that hostname in the Supabase Auth redirect allow-list and serve the generated `/.well-known/assetlinks.json` file from the same web origin.

The bundled UI opens without network access and shows a connection notice. Patient data, edits, uploads, and AI work require connectivity. No clinical data is cached for offline use.
