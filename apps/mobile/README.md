# CliniX Android shell

A Capacitor 8 app that loads the deployed web app (`server.url`). Web deploys reach installed phones immediately; only native changes need a new APK. A bundled `www/offline.html` shows when the site cannot be reached.

## Build a debug APK

Needs JDK 21 and the Android SDK (`ANDROID_HOME`), e.g. via Android Studio.

```bash
export CLINIX_APP_URL=https://app.<domain>            # required, https only
export CLINIX_ALLOW_NAVIGATION=<project>.supabase.co  # optional, comma-separated hosts
npm run build:android                                 # from the repo root
# -> apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`cap sync` writes the URL into `android/app/src/main/assets/capacitor.config.json`, which is gitignored. Run the sync again whenever the URL changes.

## Signed release

Create a keystore **outside the repo** and never commit it. Then follow Capacitor's Android signing guide, or add a signing config to `android/app/build.gradle` that reads the keystore path and passwords from environment variables. `npm run build:android:release` builds the unsigned release APK.

## What the web app does in the shell

The shell appends `CliniXApp` to the WebView user agent. `apps/web/src/lib/native.ts` uses it to:

- map the hardware back button to browser history, closing the app at the first screen (`@capacitor/app`; Capacitor core does not do this on its own);
- save and share generated prescription PDFs through the system share sheet, because a blob URL cannot be opened externally.

## Limits

- Capacitor documents `server.url` as intended for development. It is used here on purpose; the cost is that the app needs a connection and a bad web deploy affects installed apps at once.
- Google Play may reject an app that is only a website wrapper. Direct APK distribution works.
- Email confirmation links open in the phone's browser, not in the app. Users sign in with their password inside the app. Android App Links would fix this later.
- Fully offline use would need the dynamic `[id]` routes converted to query parameters and a static export. Not done.
- `android:allowBackup` is off so the saved session is never copied into device backups.
