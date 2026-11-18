# Testing and gates

What each check covers, what it needs, and where its output goes.

Last verified: 2026-11-18 against `package.json` and the Playwright configs.

| Check | Command | Needs | Covers |
|---|---|---|---|
| Types | `npm run typecheck` | — | web (+ service worker), API, worker |
| Lint | `npm run lint` | — | web ESLint |
| Unit | `npm run test` | — | Vitest in web, API and worker (`*.test.ts(x)` next to the source) |
| Build | `npm run build` | — | `next build` + `serwist build` → `apps/web/public/sw.js` |
| Browser | `npm run test:browser` | Chromium | Playwright on a dev server at `127.0.0.1:3100`. Auth and API are mocked; specs in `apps/web/e2e/` (`pwa.spec.ts` excluded) |
| PWA | `npx playwright test -c apps/web/playwright.pwa.config.ts` | Chromium | Production build on `:3200`: manifest, service-worker control, offline fallback, cache exclusion, 320/393 px |
| Live smoke | `npx playwright test -c apps/web/playwright.live.config.ts` | Running stack (`LIVE_WEB_URL`, default `:12455`) | `apps/web/e2e-live/` |
| API gates | `node services/api/gate-phase3.mjs` … `gate-phase8.mjs` | API on `:4000` (`GATE_API_BASE_URL`), synthetic gate accounts, `npm run seed` for phase 8 | Real API flows against Supabase |
| Auth gate | `npm run test:auth:live --workspace @clinix/api` | Supabase gate accounts | Token verification + onboarding |
| Gateway | `npm run preflight:gateway --workspace @clinix/worker` | 9Router credentials | Live model routes, without patient data |
| Replays | `node services/worker/check-replays.mjs` | — | Pattern scan of recorded AI replays for identifiers |

## Notes

- **Screenshots** taken by e2e specs go to `apps/web/test-results/screens/`, which is gitignored. Design references live in [`../design/ClinixAI-v2.figcraft`](../design/ClinixAI-v2.figcraft), not in screenshots.
- **The first Playwright run** after a cold start can time out while the dev server compiles. Retry once. Running `next dev` may rewrite `apps/web/next-env.d.ts`; revert it before you commit.
- **Mocks need real shapes.** A mock that returns `[]` where the page expects an object shows the error state. Copy the fixtures in `apps/web/e2e/dock.spec.ts`.
- **Gates write to the shared Supabase project.** They leave synthetic practices, users and appointments behind, and there's no cleanup script. Never point a gate at real data.
- **The `gate-phase4.mjs` finalize leg** fails by design: it predates the prescription review gate (`409 REVIEW_REQUIRED`). Its other legs pass.
- **Don't run several stacks at once.** Two of them exceed the session pool (`EMAXCONNSESSION`).

## CI

`.github/workflows/`:

- `docker-publish.yml`: on PR/push it runs typecheck, unit, browser and both UI builds, and validates the images. On `master` it publishes private GHCR images tagged with the full SHA.
- `deploy-production.yml`: manual promotion of a built SHA to Dokploy. See [deployment.md](deployment.md).
- `android-release.yml`: builds a signed APK as a private prerelease.
