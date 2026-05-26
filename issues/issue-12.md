## Domain: Logistics

---

### Issue [Refactor] Migrate Shipments route to Offset-based pagination

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Frontend `shipmentApi.getAll` expects offset-based pagination `{ data: Shipment[], page, limit, total }` for historical reporting. Backend uses cursor pagination (`cursor`, `limit`).
- **Implementation:** Refactor `getShipmentsService` in `shipments.service.ts` to perform standard skipped mongoose queries and return page count and total records.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] GET `/api/shipments` query accepts `page` and `limit` params.
- [ ] Response returns `{ data: Shipment[], page, limit, total }` inside the standard wrapper.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Write integration tests verifying offset numbers and total document math.
- [ ] Confirm performance on large database seeds.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-12-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
