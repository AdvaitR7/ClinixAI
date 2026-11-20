# Contributing

Start with [local development](docs/operations/local-dev.md) and use a separate Supabase project with synthetic data. Open pull requests against `master`.

Run `npm run typecheck`, `npm run lint` and `npm run test` before opening a pull request. For UI changes, run `npm run test:browser` after installing Chromium (`npx playwright install chromium`). See [testing and gates](docs/operations/testing.md) for checks that write to a test project.

Keep changes focused, include tests where appropriate and update the relevant spec in [`docs/`](docs/README.md) when changing behavior. Backend endpoints belong in Fastify under `/api/v1`, not in Next.js route handlers. AI, OCR and voice outputs must remain drafts until a doctor explicitly finalizes them.

Never include real patient data, credentials, populated `.env` files or sensitive screenshots in commits, issues or pull requests. Report security concerns using [SECURITY.md](SECURITY.md).
