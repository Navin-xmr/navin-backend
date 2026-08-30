# Reports

This folder contains dashboards and tooling for monitoring the Navin backend.

## Roadmap Dashboard

A visual tracking dashboard for the 60-issue wave progress.

### Generate the roadmap

From the repository root:

```bash
node reports/generate-roadmap.js
```

This reads from `issues-data.json` and generates [`ROADMAP_DASHBOARD.html`](./ROADMAP_DASHBOARD.html).

The dashboard displays:
- **Tier Distribution** — Donut chart of Easy/Medium/Hard issue counts
- **Completion Status** — Progress bar showing Open vs Closed with percentage
- **Domain Breakdown** — Stacked bar chart by module (API-QA, Auth, Users, Shipments, Payments, Telemetry, WebSockets)
- **Hard Issues Hot-List** — Top 10 Hard-tier issues by domain
- **Summary Grid** — Quick counts and issue range coverage (#325–#390)

All charts render with inline SVG and CSS—no external CDN dependencies.

---

## API Surface Coverage Reports

This folder holds tooling that detects **drift** between the OpenAPI document (`docs/swagger.yaml`) and the live Express route table (`src/app.ts` mounts + `src/modules/**/*.routes.ts` handlers).

### Generate the coverage report

From the repository root:

```bash
node reports/generate-coverage.js
```

This writes (or overwrites) [`API_SURFACE_COVERAGE.html`](./API_SURFACE_COVERAGE.html).

Open the HTML file in a browser to inspect:

| Column | Meaning |
|--------|---------|
| Method / Path | Normalized HTTP operation (`:id` and `{id}` treated as equivalent) |
| In Swagger | Path+method present in `docs/swagger.yaml` |
| In Code | Path+method present on a mounted Express router (or an unmounted `*.routes.ts` module flagged in the orphan section) |
| Drift status | `aligned`, `swagger-only`, or `code-only` |

## When to run

- After adding or removing an endpoint
- Before merging changes that touch `*.routes.ts` or `docs/swagger.yaml`
- Optionally in CI as a soft check (script exits `0` even when drift exists so it can run as a report job)

## Interpretation tips

- **swagger-only** — docs claim a route that is missing from mounted code (stale Swagger, or a router never wired in `src/app.ts`, e.g. ledger).
- **code-only** — Express serves a route that Swagger does not document (historically the shipment timeline route).
- Unmounted routers are listed separately so contributors can tell “defined but not reachable” from true Swagger drift.
