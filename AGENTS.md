# Navin Backend — AI Agent Instructions

## 1. Overview
This is a logistics/supply-chain API: shipments, org roles, telemetry, and Stellar blockchain (proof-of-delivery, escrow).

Stack: TypeScript Strict · Express · MongoDB/Mongoose · Zod · JWT+Redis · Jest+Supertest.

### Program state — read before working

- **`TODO.md` is the canonical work tracker** (Parts 1–4). Check it before inventing tasks; several known-failing tests are tracked there with owners/plans.
- **Tests deliberately do NOT gate CI yet** (TODO H4 decision): `ci.yml` enforces deps-audit/typecheck/build/lint/docker; the test suite has a known red baseline being remediated. Your duty: do not *increase* failures (see §4).
- **Auth policy (decided 2026-08-25):** signup always assigns `VIEWER` — never implement email-domain-based role elevation (#147 resolved Option A). Elevation is invitations-only.
- **Chain direction:** Stellar integration moves behind a `ChainAdapter` port (simulated vs Soroban); current `stellar.service.ts` manage-data ops are placeholders, escrow moves no funds. See TODO Part 3 before touching chain code.
- **Realtime event names** come from `src/shared/types/socketEvents.ts` constants — never string literals (`telemetry_update`/`payment_status_changed` are dead names; live: `location:update`, `shipment:status`, `anomaly:detected`, `settlement:status`).

## 2. Architecture
Request flow:

`Route → validateRequest(Zod) → requireAuth → requireRole → asyncHandler(Controller) → Service → Model/Repo`

| Directory | Purpose |
|-----------|---------|
| `src/modules/<domain>/` | Self-contained domain: routes, controller, service, model, validation |
| `src/infra/` | DB, Redis, queues, Socket.IO |
| `src/services/` | External integrations (Stellar, storage) |
| `src/shared/` | Errors, middleware, types, constants, plugins |
| `tests/` | Integration and API tests |

## 3. Conventions (Hard Rules)

**Response envelope** — Always return `{ success, message, data, meta? }` via `sendResponse()`. Dates as ISO 8601 UTC. Put pagination in `meta`, not the body.

**Errors** — Controllers never catch; wrap them in `asyncHandler`. Services throw `AppError(status, msg, code)`, never bare `Error`. Codes look like `ERR_<DOMAIN>_<DESC>` and live in `src/shared/http/errors.ts`.

**Types** — No `any` (prefer `unknown`). Services return plain objects, not Mongoose documents. One declaration per name per file. Use `import type` for types only. Relative imports end in `.js`.

**Security** — Protect every route with `requireAuth` + `requireRole`, or mark it `// PUBLIC: <reason>`. Never log secrets. Strip `passwordHash` in `toJSON`. Don't spread `req.query` into DB queries. Use `logger`, not `console.*`.

**Database** — Soft-delete with `deletedAt`. Models use `isoDatePlugin` and soft-delete pre-hooks. Zod owns request shape; Mongoose owns data integrity.

**Testing (ESM)** — Register mocks in this order: `jest.resetModules()` → `jest.unstable_mockModule(...)` → dynamic `await import()`. Build mock factories from `tests/helpers/mocks.ts`; test data from `tests/fixtures/factories.ts` (real ObjectIds — `'ship-1'` style ids bypass guards and make tests vacuous). Never hand-roll module factories that omit exports the source imports.

**Realtime** — Emit and assert socket/SSE events using the exported name constants from `src/shared/types/socketEvents.ts`, never string literals.

## 4. Testing & Documentation
Cover every endpoint for **200**, **401**, **403**, and **400/422**. Mock externals via `tests/helpers/mocks.ts` (Stellar, storage, sockets, queues). Keep `docs/swagger.yaml` in sync with every endpoint change.

Test battery before done:

```bash
npm run lint && npm run typecheck && npm run build   # must be fully green
npm test -- <suites for files you touched>           # must be green
npm test                                             # full suite — see note
```

> The full suite currently has a **known red baseline** (tracked in `TODO.md` Part 1). Do not fix unrelated failing suites inside an unrelated PR — but your PR must not add new failures. If a suite you touched fails for a pre-existing reason, cite the TODO item instead of scope-creeping.

## 5. Agent Skills Pipeline
After writing code, run these in order and fix issues before moving on:

1. **Cross-Check** — `.agents/skills/cross-check/SKILL.md` (route ↔ controller ↔ service ↔ model ↔ Zod ↔ Swagger)
2. **Cleanup** — `.agents/skills/cleanup/SKILL.md` (duplicates, conventions, security, `any`)
3. **Document** — `.agents/skills/document/SKILL.md` (Swagger, JSDoc, error codes)

## 6. Quality Gates
Treat these as hard stops:

| Gate | Rule |
|------|------|
| Verify-first | Don't assume a symbol exists — open the file |
| One-declaration | Each identifier once per file; search before adding |
| Compile-first | Mentally check types after edits; run `npm run build` at the end |
| Single-concern | One edit = one concern; 4+ files → outline first |
| No floating promises | Async work in `setImmediate` needs `.catch()` or try/catch |

## 7. Architecture Boundaries
Modules stay self-contained. Cross-module imports only along these lines:

| Consumer | Allowed Dependencies |
|----------|---------------------|
| `auth` | `users` |
| `invitations` | `users` |
| `ledger` | `shipments` (shared types) |
| `payments` | `shipments` (model refs) |
| `shipments` | `payments` (dispute/settlement hooks) |
| `telemetry` | `shipments` (model refs) |
| `users` | `organizations` |
| `webhooks` | `shipments`, `telemetry` |
| `analytics` | `shipments`, `payments` |
| `events` | `infra/redis` |
| `notifications` | `users` (preferences) |
| `telemetry`/`payments`/`shipments`/`webhooks` | `src/services/chain` (**port types only** — planned per TODO Part 3; never import Stellar implementations directly) |

Prefer domain events over direct service calls. Never import a sibling controller. Avoid circular deps — pull shared logic into `src/shared/` or emit events. When you add a new dependency, note it here and in the consumer module's `AGENTS.md`.

## 8. Pre-Commit Checklist
- [ ] No `any` · no `console.*` · no `try/catch` in controllers
- [ ] No `res.json()` (use `sendResponse`) · no `new Error()` (use `AppError`)
- [ ] `requireAuth` on all routes (or `// PUBLIC: <reason>`)
- [ ] No `...rest` into DB queries · no duplicate imports/declarations
- [ ] Zod schemas export inferred types · models use `isoDatePlugin` + soft-delete
- [ ] Swagger updated · `npm run build` passes · touched-module tests pass (see §4 baseline note)
- [ ] **AGENTS.md reviewed if conventions, boundaries, or module structure changed**

### Clean-Install Build Triage (hard rule)

Build triage must be based strictly on `package.json`, `package-lock.json`, and source files.

- **Never** assume a package is available because it exists locally — CI runs `npm ci` from scratch.
- If a new runtime import is added, it **must** go in `dependencies` (not `devDependencies`).
- Run `npm run check:deps` before committing to catch undeclared imports.
- Dev-only imports under `src/` (seed scripts, test infra) need an allowlist entry in `scripts/check-undeclared-deps.js` — follow the documented `mongodb-memory-server`/`@faker-js/faker` precedent.
- To reproduce CI locally: `rm -rf node_modules && npm ci && npm run build`
- CI pins Node.js 20 via `.github/workflows/ci.yml` and always uses `npm ci`.

## 9. Token Efficiency
Read before you write. Batch parallel reads. Cite `file:line`. Prefer small diffs. Skip filler prose.

## 10. Reviewing & Updating Agent Documentation
This file is guidance, not scripture. Update it by hand when conventions actually change so the next person (or agent) isn't working from stale advice.

| Change | Review these files |
|--------|------------------|
| New module | Root §7; add module `AGENTS.md` from `__template__` |
| Convention change | Root §3; affected module `AGENTS.md` files |
| Structural rename in a module | That module's `AGENTS.md` (only if the pattern changed) |
| New cross-module dependency | Root §7; consumer module's `AGENTS.md` |
| New shared utility | Root §2; `src/shared/` docs if any |
| Stale prompt | `.agents/prompts/*.md` |
