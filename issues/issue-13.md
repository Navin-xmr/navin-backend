## Domain: Logistics

---

### Issue [Feature] Extend Shipment search query parameters (Origin & Destination)

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Frontend dashboard filters shipments by exact origin and destination. Backend filters do not search these fields dynamically.
- **Implementation:** Introduce optional query filters in `findShipments` to match origin and destination matching regex parameters.

**Dependencies:**
- Depends on issue-12.md

**Acceptance Criteria:**
- [ ] GET `/api/shipments` query supports `origin` and `destination` queries.
- [ ] Matches partial addresses case-insensitively.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Seed shipments and query specific cities to verify filters.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-13-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
