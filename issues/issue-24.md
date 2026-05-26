## Domain: Telemetry

---

### Issue [Feature] Bulk Telemetry Ingestion API for offline transportation

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Shipments traversing ocean routes lose cellular signal and must bulk-upload saved log arrays when returning to network coverage.
- **Implementation:** Build `/api/telemetry/bulk` endpoint accepting arrays of sensor points and process them in bulk database inserts.

**Dependencies:**
- Depends on issue-20.md

**Acceptance Criteria:**
- [ ] Processes arrays of up to 1000 items in single operations.
- [ ] Rejects batch if items fail validation criteria.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Unit test bulk insertions and assert performance under stress.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-24-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
