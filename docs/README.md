# CliniX AI documentation

The single source of truth for the product, the architecture, the code layout and operations. Specs here win over code. If two docs conflict, ask the project owner ([CLAUDE.md](../CLAUDE.md)).

## Start here

1. [codebase-map.md](codebase-map.md): where everything lives and where to make common changes
2. [history.md](history.md): what was decided, why, when and where (read before reopening a decision)
3. [status.md](status.md): what works, what is partial, and what blocks release

## Read by task

| You are… | Read |
|---|---|
| Working out what the product is and why | [product/context.md](product/context.md) |
| Building or changing a screen | [product/screen-map.md](product/screen-map.md) → [design/DESIGN.md](design/DESIGN.md) → [product/screen-catalog.md](product/screen-catalog.md) |
| Adding or changing an endpoint | [architecture/api-contract.md](architecture/api-contract.md), [architecture/auth.md](architecture/auth.md) |
| Changing tables or migrations | [architecture/database.md](architecture/database.md) |
| Touching AI, OCR or safety | [architecture/overview.md](architecture/overview.md) (AI pipeline and safety layer), [product/context.md](product/context.md) §17–20 |
| Touching sign-in, roles or onboarding | [architecture/auth.md](architecture/auth.md) |
| Adding a route, or anything Android or PWA | [architecture/mobile.md](architecture/mobile.md) |
| Running locally | [operations/local-dev.md](operations/local-dev.md) |
| Testing, or running a gate | [operations/testing.md](operations/testing.md) |
| Deploying, rolling back, or releasing an APK | [operations/deployment.md](operations/deployment.md), [operations/environment.md](operations/environment.md) |
| Rehearsing the demo | [operations/demo-rehearsal.md](operations/demo-rehearsal.md) |

## Layout

```
docs/
├── README.md            this map
├── codebase-map.md      code layout and change recipes
├── history.md           decision log
├── status.md            implementation status and release blockers
├── product/             context (product spec), screen catalog, screen map
├── architecture/        overview, API contract, database, auth, mobile
├── design/              DESIGN.md (Clear v2 tokens and rules) and ClinixAI-v2.figcraft (design source)
└── operations/          local dev, testing, deployment, environment, demo rehearsal
```

## Keeping it true

- Every doc opens with its purpose and a `Last verified:` date. Update the date when you check a doc against the code.
- **Change the code, then the doc, in the same commit.** That covers a new route (screen-map), a new domain module (codebase-map), a new migration (database) and a new decision (history).
- No screenshots, generated dumps or per-session logs go in `docs/`. Test screenshots go to `apps/web/test-results/screens/`. Design references live in the `.figcraft` file.
- Plans for in-flight work go in `code-agent/c-plans/`. When one is finished, distill it into [history.md](history.md) and [status.md](status.md), then delete it.
- Synthetic data only. Never put secrets, credential values or real patient data in any doc.
