## Domain: Settlements

---

### Issue [Feature] Build Payments History REST endpoint GET /api/payments

**Tier:** 🟡 Medium

**Description:**
- **Problem:** We need to query and search payments histories. Currently page displays mock table.
- **Implementation:** Expose protected route `/api/payments` that lists payment history for the user's organization.

**Dependencies:**
- Depends on issue-36.md

**Acceptance Criteria:**
- [ ] List route accepts `status` query filters.
- [ ] Supports paginated envelopes.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Query transaction logs and assert data boundaries.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-37-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
