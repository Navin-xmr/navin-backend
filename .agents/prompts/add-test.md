# Prompt: Add tests for an existing endpoint

## Context
An endpoint exists but lacks complete test coverage (200 · 401 · 403 · 400).

## Instructions

1. **Read** the route file to understand the auth/role/validation chain.
2. **Read** the controller and service to understand the happy-path response shape.
3. **Read** an existing test in the same module to copy the setup pattern (mock imports, DB seeding, auth headers).
4. **Use fixtures** — Import factory functions from `tests/fixtures/factories.ts` for test data. Avoid inventing ad-hoc mock shapes.
5. **Write tests** covering:
   - **200 happy path** — assert response envelope shape (`success`, `message`, `data`, optional `meta`).
   - **401 unauth** — missing or invalid token.
   - **403 role** — token for a role that is not allowed.
   - **400 validation** — missing body fields, invalid query params, etc.
6. **Mock externals** — Use `jest.unstable_mockModule` for Stellar, email, storage, etc. See `tests/helpers/mocks.ts`. Order is law: `jest.resetModules()` → mock registration → dynamic `await import()`.
7. **Determinism & validity** — Test data via `tests/fixtures/factories.ts` (real ObjectIds; string ids like `'ship-1'` bypass guards). Assert exact intended statuses — no `[200,404]` hedges or `.not.toBe(403)`. For socket events use constants from `src/shared/types/socketEvents.ts`.
8. **Run tests** — Execute `npm test -- <test-file>` and fix failures before finishing.
9. **Update docs** — If the test reveals a missing or incorrect convention, update the module's `AGENTS.md`.

## Output format
Return the test file path and a checklist of scenarios covered. Do not dump full test code unless asked.
