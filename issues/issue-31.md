## Domain: Telemetry

---

### Issue [Optimization] Optimize Average Delivery Time Aggregation pipelines in MongoDB

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Calculating average logistics delivery times iterates over thousands of shipments. Aggregate queries must run on optimal indices.
- **Implementation:** Optimize milestones matching inside Mongoose aggregates with structured project fields.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Aggregation matches indexes.
- [ ] Query response returns in <50ms.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Analyze query execution plans via Mongo debug logs.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-31-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
