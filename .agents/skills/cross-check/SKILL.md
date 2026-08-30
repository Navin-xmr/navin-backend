---
name: cross-check
description: Pre-commit validation that cross-references every code change against project contracts, types, and sibling layers to prevent integration drift.
---

# Skill: Cross-Check

## Purpose
Run this skill **after writing code but before committing** to verify that every change is consistent across all layers of the stack. This prevents the most common agent failure mode: changing one layer while leaving dependent layers out of sync.

---

## Step 1 — Route ↔ Controller ↔ Service Contract Alignment

For every route file touched (`src/modules/*/routes.ts`):

1. **Verify the middleware chain** is complete and in correct order:
   ```
   requireAuth → requireRole([...]) → validateRequest({ body?, query?, params? }) → asyncHandler(controller)
   ```
   - Missing `requireAuth`? → Add it (unless the route has a `// PUBLIC: <reason>` comment).
   - Missing `asyncHandler`? → Wrap the controller.
   - Missing `validateRequest`? → Add the Zod schema reference.

2. **Verify HTTP method and path** match the controller's intent:
   - `GET` for reads, `POST` for creates, `PATCH` for partial updates, `DELETE` for removals.
   - Path params (`:id`, `:shipmentId`) must have a matching `params` Zod schema.

3. **Verify controller → service call** passes only validated, typed data:
   - Controller must cast `req.body` to the Zod-inferred type: `const body = req.body as CreateShipmentBody;`
   - Controller must NOT spread raw `req.query` or `req.body` into service calls. Destructure explicitly.

---

## Step 2 — Zod Schema ↔ Mongoose Model Alignment

For every Zod validation file touched (`src/modules/*/validation.ts`):

1. **Field-by-field comparison** — Open the corresponding Mongoose model and verify:
   - Every `required: true` Mongoose field has a **non-optional** Zod field (unless the service provides a default).
   - Every Zod `.optional()` field has either a Mongoose `default` or the service fills it before `Model.create()`.
   - Enum values in Zod (`z.enum([...])` or `z.nativeEnum(...)`) match the Mongoose `enum` array exactly.

2. **Type alignment** — Verify Zod coercion matches Mongoose types:
   - `z.coerce.number()` ↔ `{ type: Number }`
   - `z.coerce.date()` ↔ `{ type: Date }`
   - `z.string()` ↔ `{ type: String }`

3. **No orphan schemas** — Every exported Zod schema must be referenced in at least one route's `validateRequest()` call. Unused schemas are dead code.

---

## Step 3 — Response Envelope Verification

For every controller function touched:

1. **Success responses** must use:
   ```typescript
   sendResponse(res, statusCode, true, 'Message', data, meta?)
   ```
   - `data` is the primary payload (object, array, or null).
   - `meta` is for pagination (`{ cursor, hasMore, total }`). Never put pagination in `data`.

2. **Error responses** must throw `AppError` — never call `sendResponse` with `success: false` manually.

3. **Status codes** must be semantically correct:
   - `200` — successful read/update
   - `201` — successful create
   - `202` — accepted for async processing (webhooks)
   - `204` — successful delete (no body), OR `200` with confirmation data
   - `400` — validation error
   - `401` — unauthenticated
   - `403` — forbidden (role mismatch)
   - `404` — resource not found
   - `409` — conflict (duplicate)
   - `429` — rate limited

---

## Step 4 — Type Interface ↔ Service Return Alignment

For every service file touched (`src/modules/*/service.ts`):

1. Services must return **plain objects or interfaces** from `src/shared/types/`, never raw Mongoose Documents.
   - Use `.lean()` on queries, or map documents to interfaces.
2. Service function signatures must have explicit return types — no implicit `any` returns.
3. If a service creates or updates a record, verify it returns the created/updated object so the controller can pass it to `sendResponse`.

---

## Step 5 — Swagger Spec Sync

For every endpoint changed or added:

1. Open `docs/swagger.yaml`.
2. Verify the path, method, request body schema, query parameters, and response schema match the implementation.
3. If the endpoint is new, add the full Swagger definition. If it changed, update it.
4. Verify security requirements (`bearerAuth`, `apiKeyAuth`) match the route's middleware.

---

## Step 6 — Test Coverage Cross-Check

For every service or controller function changed:

1. Open the corresponding test file in `tests/`.
2. Verify tests exist for:
   - **Happy path** (200/201 with valid data)
   - **401** (no auth token)
   - **403** (wrong role)
   - **400/422** (invalid body/query)
   - **404** (missing resource)
3. If any test case is missing, create it. If an existing test contradicts the new behavior, update the test (never delete tests without explicit instruction).

### Test hygiene rules

1. **Mock factories come from helpers** — `tests/helpers/mocks.ts` for module mocks (spread `jest.requireActual` so new exports degrade gracefully), `tests/fixtures/factories.ts` for data. Never hand-roll a factory that omits exports the source imports — that is the #1 suite-killing failure mode.
2. **ESM ordering is law** — `jest.resetModules()` → `jest.unstable_mockModule(...)` → dynamic `await import()`. Registering mocks after reset silently discards them.
3. **Realtime assertions use constants** — import event names from `src/shared/types/socketEvents.ts`; string literals like `'telemetry_update'` are stale names that guarantee timeouts.
4. **Positive assertions assert exact statuses** — `.not.toBe(403)` or `[200,404]` hedges let regressions slip; assert the intended status.
5. **Use real ObjectIds** — string ids like `'ship-1'` trip `ObjectId.isValid()` guards and make tests vacuously exercise defaults instead of the code under test.

---

## Output

After completing the cross-check, produce:

```
CROSS-CHECK REPORT
Files checked: <list>
- Route ↔ Controller alignment: OK / <issues>
- Zod ↔ Mongoose alignment: OK / <issues>
- Response envelope: OK / <issues>
- Type contracts: OK / <issues>
- Swagger sync: OK / <issues>
- Test coverage: OK / <missing cases>
```
