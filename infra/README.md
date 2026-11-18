# infra

Deployment configuration only. The documentation is in [`docs/operations/`](../docs/operations/).

| File | Used by | Purpose |
|---|---|---|
| `dokploy/docker-compose.yml` | Dokploy, `scripts/deploy/promote.mjs` | Background stack: `migrate`, `worker`, `verify`, `backup` |
| `dokploy/backup.Dockerfile` | CI (`docker-publish.yml`) | Image for the daily database and Storage backup |
| `supabase/bucket.sql` | Run once by hand in Supabase | Creates the private `clinix-documents` Storage bucket |

The web app and API deploy to Vercel from `apps/web/vercel.json` and `services/api/vercel.json`. See [deployment.md](../docs/operations/deployment.md).

Don't move these files. CI and the promotion script reference their paths.
