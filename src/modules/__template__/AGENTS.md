# Module Template

**Usage:** `cp -r src/modules/__template__ src/modules/<domain>` then rename `template*` → `<domain>*`.

**Route prefix:** Register in `src/app.ts` as `app.use('/api/<plural-domain>', <domain>Router);`

**Expected files:**
- **Routes** — `requireAuth` → `requireRole` → `validateRequest(Zod)` → `asyncHandler(controller)`
- **Controller** — thin handlers, `sendResponse()`, no `try/catch`
- **Service** — `AppError` throws, plain object returns
- **Model** — `isoDatePlugin`, `deletedAt`, soft-delete pre-hooks
- **Validation** — Zod schemas with exported inferred types
- **Tests** — 200 · 401 · 403 · 400 coverage

**Conventions:** See root `AGENTS.md` for all hard rules.

**Cross-module deps:** Only from `src/shared/` and `src/infra/` unless root `AGENTS.md` § Architecture Boundaries explicitly allows a sibling module.

**Maintenance:** Review manually when this template's patterns change.
