## Domain: Telemetry

---

### Issue [Feature] Calibrate Battery Warn triggers for IoT trackers

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Battery alerts are not standardized, causing false warnings or failure events on low charge levels.
- **Implementation:** Standardize minimum battery alerts limits to trigger warning at exactly 20%.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Anomaly trigger is mapped to 20% limit.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert warning generated only for charge <= 20%.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-28-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
