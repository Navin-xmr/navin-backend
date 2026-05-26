## Domain: Telemetry

---

### Issue [Maintenance] Automated job for historical resolved anomalies cleanup

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Over time, database size scales heavily with old resolved warnings. We need clean routines.
- **Implementation:** Create database maintenance worker to purge old resolved items after 90 days.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Scheduled maintenance execution removes expired records safely.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Insert expired resolved logs and assert removal by cleanup worker.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-29-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
