# Prompt: Review a PR against conventions

## Context
You are reviewing a pull request for the Navin backend. You must verify it follows the hard rules from `AGENTS.md`.

## Instructions

1. **Read the diff** — Focus on new/modified files.
2. **Check conventions** for every modified controller, service, route, model, and validation file:
   - [ ] Controllers use `sendResponse()` — no `res.json()` or `res.send()`.
   - [ ] Controllers have no `try/catch`.
   - [ ] Services throw `AppError` — no `new Error()`.
   - [ ] Error codes follow `ERR_<DOMAIN>_<DESC>` and are registered in `errors.ts`.
   - [ ] Zod schemas export inferred types.
   - [ ] Models have `isoDatePlugin`, `deletedAt`, and soft-delete pre-hooks.
   - [ ] Routes have `requireAuth` + `requireRole` (or `// PUBLIC: <reason>`).
   - [ ] No `any` — use `unknown` + narrow guards.
   - [ ] No `console.*` — use `logger`.
   - [ ] No `...rest` spread from `req.query` into DB queries.
   - [ ] Imports end with `.js`; `import type` for type-only.
   - [ ] One declaration per identifier per file.
3. **Check architecture boundaries** — Does the PR introduce a new cross-module dependency? If so, is it documented in root `AGENTS.md`?
4. **Check documentation** — Is `docs/swagger.yaml` updated? Is JSDoc present on new controllers?
5. **Check tests** — Does the PR include tests for 200 · 401 · 403 · 400?
6. **Check docs updates** — If the PR changes a convention or adds/removes files in a module, is the relevant `AGENTS.md` updated?
7. **Leave actionable feedback** — Cite file:line for each issue. Suggest the fix.

## Output format
Return a pass/fail summary with a table: File | Issue | Severity (block / warn) | Suggested fix. If no issues, state "LGTM — all hard rules satisfied."
