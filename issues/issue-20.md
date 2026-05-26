## Domain: Telemetry

---

### Issue [Feature] Rigorous validation parameters for Telemetry ingestion

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Telemetry receiver expects raw numbers but lacks bounds validations. Extreme data (e.g. negative battery) can contaminate analytics.
- **Implementation:** Create strict Zod validator schemas for `POST /api/telemetry` bounds checks.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Temperature within -50 to 100.
- [ ] Battery percentage limited strictly to 0 to 100.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Test bounds limits with invalid values in unit tests.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-20-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
