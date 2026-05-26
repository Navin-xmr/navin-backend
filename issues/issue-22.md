## Domain: Telemetry

---

### Issue [Optimization] Optimize Mongo indexes for sensor query pipelines

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Fetching large sensor logs for rendering historical charts runs slow due to missing composite indexes in telemetry collections.
- **Implementation:** Create composite indexing on `{ shipmentId: 1, timestamp: -1 }` inside the telemetry Mongoose model.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Telemetry index exists.
- [ ] Query execution times drop below 10ms.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Verify query plans using Mongoose `.explain("executionStats")`.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-22-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
