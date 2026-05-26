## Domain: Telemetry

---

### Issue [Optimization] Cache historical delayed counts in Redis

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Delayed shipments count calculations are heavy aggregates. We need fast cached counters.
- **Implementation:** Cache analytics dashboard counts in Redis cache with 5 minutes time-to-live triggers.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Subsequent requests read directly from Redis.
- [ ] Counters automatically invalidate when shipment status changes.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert database is not queried on second controller request.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-32-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
