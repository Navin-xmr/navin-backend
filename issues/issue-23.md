## Domain: Telemetry

---

### Issue [Feature] Expose Telemetry configurations threshold endpoint

**Tier:** 🟢 Easy

**Description:**
- **Problem:** The frontend displays green/red status rings around sensor cards, but thresholds are hardcoded on client. We need dynamically served bounds.
- **Implementation:** Build `GET /api/telemetry/thresholds` endpoint to return system limits.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Returns `{ maxTemp, maxHumidity, minBatteryLevel }` schema.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Request thresholds endpoint and assert payload matches boundaries.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-23-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
