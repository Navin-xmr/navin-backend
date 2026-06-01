# Navin Backend — AI Agent Instructions

## 1. Overview & Stack

Logistics/supply-chain API: shipments, org roles, telemetry, Stellar blockchain (proof-of-delivery, escrow).

| Layer | Tech |
|-------|------|
| Language | TypeScript Strict |
| Framework | Express.js |
| DB | MongoDB / Mongoose |
| Validation | Zod (all payloads) |
| Auth | JWT + Redis blocklist |
| Blockchain | Stellar SDK |
| Testing | Jest + Supertest |
| Lint | Prettier + ESLint |

## 2. Architecture

**Flow:** `Route → validateRequest(Zod) → requireAuth → requireRole → asyncHandler(Controller) → Service → Model/Repo`

| Directory | Purpose |
|-----------|---------|
| `src/modules/<domain>/` | Self-contained: routes, controller, service, model, validation |
| `src/infra/` | DB, Redis, Queues, Socket.IO |
| `src/services/` | External integrations (Stellar, Storage) |
| `src/shared/` | Errors, middleware, types, constants, plugins |
| `tests/` | Integration + API tests |

## 3. Conventions (Hard Rules)

### Response Envelope
```
{ success: bool, message: string, data: T | null, meta?: { cursor, hasMore, total } }
```
- Dates → ISO 8601 UTC. Pagination → `meta` only. Use `sendResponse()` exclusively.

### Error Handling
- Controllers: NO `try/catch`. Wrap in `asyncHandler`. Throw `AppError(status, msg, code)`.
- Services: throw `AppError` — never `new Error()`.
- Error codes: `ERR_<DOMAIN>_<DESC>` (registered in `src/shared/http/errors.ts`).

### Types & Imports
- NO `any` (use `unknown`). Services return plain interfaces, not Mongoose Documents.
- One declaration per identifier per file. `import type` for type-only. Paths end `.js`.

### Security
- All routes: `requireAuth` + `requireRole` unless marked `// PUBLIC: <reason>`.
- Never log/expose secret keys. Strip `passwordHash` in `toJSON`.
- No `...rest` spread from `req.query` into DB queries (NoSQL injection vector).
- No `console.*` — use `logger` from `src/shared/logger/logger.js`.

### Database
- Soft deletes via `deletedAt`. Models use `isoDatePlugin` + soft-delete pre-hooks.
- Zod validates requests; Mongoose schema validates data integrity.

## 4. Testing

Every endpoint needs tests for: **200** (happy) · **401** (unauth) · **403** (role) · **400/422** (validation).
Mock all externals (Stellar, Storage, IoT). Run `npm test` before done.

## 5. Documentation

Update `docs/swagger.yaml` for every endpoint change. Swagger ↔ implementation must match.

## 6. Agent Skills (Mandatory Pipeline)

After code is written, execute **in order**. Fix issues before advancing.

| # | Skill | File | Validates |
|---|-------|------|-----------|
| 1 | Cross-Check | `.agents/skills/cross-check/SKILL.md` | Route↔Controller↔Service↔Model↔Zod↔Swagger alignment |
| 2 | Cleanup | `.agents/skills/cleanup/SKILL.md` | Duplicates, conventions, security, `any` usage |
| 3 | Document | `.agents/skills/document/SKILL.md` | Swagger, JSDoc, changelog, error codes |

## 7. Execution Steps

1. **Read** existing patterns in `src/shared` and target module.
2. **Schema** — Zod validation + Mongoose model.
3. **Service** — Business logic with `AppError` throws.
4. **Controller** — Thin, uses `sendResponse`. Route wired with auth.
5. **Test** — Cover auth, roles, validation, happy path.
6. **Document** — Swagger + JSDoc.
7. **Skills** — Run Cross-Check → Cleanup → Document.

## 8. Quality Gates

Treat violations as hard errors. Stop and fix.

| Gate | Rule |
|------|------|
| Verify-first | Never assume a function/type/import exists. Read the file. |
| One-declaration | Every identifier declared exactly once per file. Search before adding. |
| Compile-first | Mentally verify compilation after every edit. Run `npm run build` at end. |
| Single-concern | One edit = one concern. 4+ files → outline plan first. |
| No floating promises | `setImmediate(async...)` must have `.catch()` or try/catch inside. |

### Pre-Commit Checklist
- [ ] No `any` · No `console.*` · No `try/catch` in controllers
- [ ] No `res.json()` (use `sendResponse`) · No `new Error()` (use `AppError`)
- [ ] `requireAuth` on all routes (or `// PUBLIC: <reason>`)
- [ ] No `...rest` spread into DB queries · No duplicate imports/declarations
- [ ] Zod schemas export inferred types · Models use `isoDatePlugin` + soft-delete
- [ ] Swagger updated · `npm run build` passes · `npm test` passes

### Token Efficiency
- Read before writing. Batch parallel reads. Cite file:line.
- Minimal diffs — don't rewrite files for one-line fixes.
- No filler prose. Tables/checklists over paragraphs.

