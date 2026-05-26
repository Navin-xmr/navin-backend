## Domain: Telemetry

---

### Issue [Bug] Fix timezone parsing offsets in Analytics Performance controller

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Query date ranges in `PerformanceQuerySchema` parse as local times, creating query mismatches for UTC database entries.
- **Implementation:** Enforce UTC date ranges formatting inside the query parser validation schemas.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] StartDate and EndDate converted strictly to UTC ISO strings before DB search.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Check DB aggregation pipeline dates using mock queries.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-30-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
