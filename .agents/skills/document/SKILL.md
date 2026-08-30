---
name: document
description: Generates and maintains API documentation, inline JSDoc, and changelog entries for every code change.
---

# Skill: Document

## Purpose
Run this skill **after code is finalized and tests pass** to ensure all documentation artifacts are up-to-date. Documentation is a first-class deliverable — not an afterthought.

---

## Step 1 — Swagger / OpenAPI Spec (`docs/swagger.yaml`)

For every endpoint added or modified:

### New Endpoint Checklist
Add a complete path entry with:

```yaml
/api/<module>/<path>:
  <method>:
    summary: <one-line description>
    description: <detailed description with business context>
    tags:
      - <Module>
    security:
      - bearerAuth: []    # or apiKeyAuth: [] for machine endpoints
    parameters: []         # path params, query params
    requestBody:           # for POST/PATCH/PUT
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/<SchemaName>'
    responses:
      '200':               # or 201, 202, 204
        description: <success description>
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/StandardResponse'
      '400':
        description: Validation error
      '401':
        description: Unauthorized — missing or invalid token
      '403':
        description: Forbidden — insufficient role
      '404':
        description: Resource not found
```

### Rules
1. **Every Zod schema must have a matching OpenAPI component schema** under `components/schemas/`.
2. **Response schemas must reflect the `sendResponse` envelope**: `{ success, message, data, meta? }`.
3. **Enum values** must match the TypeScript enums exactly (e.g., `ShipmentStatus`, `UserRole`, `PaymentStatus`).
4. **Date fields** must be `type: string, format: date-time`.
5. **Security** must match route middleware — `bearerAuth` for JWT, `apiKeyAuth` for API key, none only for public routes.

---

## Step 2 — Inline Code Documentation

### When to Add JSDoc
Add JSDoc comments to:
- Every **exported function** in service files (`src/modules/*/service.ts`, `src/services/*.ts`)
- Every **exported middleware** (`src/shared/middleware/*.ts`)
- Every **exported utility** (`src/shared/utils/*.ts`)
- Every **Mongoose model** file — document the schema purpose and key fields

### JSDoc Format
```typescript
/**
 * Creates a new shipment record and tokenizes it on Stellar.
 *
 * @param input - Validated shipment creation payload.
 * @param userId - Authenticated user's ID (from JWT).
 * @returns The created shipment with stellarTokenId and stellarTxHash.
 * @throws {AppError} 400 if enterpriseId/logisticsId are invalid.
 * @throws {AppError} 500 if Stellar tokenization fails.
 */
```

### Rules
1. **Do NOT add JSDoc to controllers** — they are thin wrappers; the service JSDoc is sufficient.
2. **Do NOT add JSDoc to route files** — the Swagger spec documents these.
3. **Always document `@throws`** with the `AppError` status code and condition.
4. **Never add redundant comments** like `// set the name` above `this.name = name`. Only add comments that explain *why*, not *what*.

---

## Step 3 — Error Code Registry

When adding a new `AppError` code:

1. Add the code to `src/shared/http/errors.ts` in the `ErrorCodes` object — that file is the **single source of truth**; never maintain a parallel list here.
2. Follow the naming convention: `ERR_<DOMAIN>_<DESCRIPTION>` (e.g., `ERR_SHIPMENT_ALREADY_DELIVERED`).
3. Ensure the code is documented in `docs/ERROR_CODES.md` (full registry rewrite tracked as TODO P3-10; until then, add your new code to it manually so the doc doesn't drift further).

---

## Step 4 — Changelog Entry

For every PR-worthy change, append an entry to `CHANGELOG.md` (create if it doesn't exist) under the `## [Unreleased]` section:

```markdown
## [Unreleased]

### Added
- `POST /api/shipments/:id/proof` — delivery proof upload with file validation (#43)

### Fixed
- Duplicate `sendResponse` call in proof upload controller (#43)

### Security
- Added signature verification to Stellar webhook endpoint (#46)

### Changed
- Replaced `console.log` with structured logger in shipment service (#54)
```

### Rules
1. Use **Added**, **Fixed**, **Changed**, **Removed**, **Security**, **Deprecated** categories.
2. Reference the issue number with `(#<number>)`.
3. One line per change — concise and scannable.

---

## Step 5 — README Maintenance

If a change affects:
- **Environment variables** → Update `.env.example`, `src/env.ts` (Zod schema), and `docs/environment-variables.md` — all three must stay in sync; README only links to them.
- **New module** → Add the module to the Architecture section.
- **New dependency** → Document why it was added and its version.
- **Breaking API change** → Add a migration note.

---

## Output

After completing documentation:

```
DOCUMENT REPORT
- Swagger paths updated: <list>
- Swagger schemas added: <list>
- JSDoc functions documented: <count>
- Error codes added: <list>
- Changelog entries: <count>
- README updated: YES/NO
```
