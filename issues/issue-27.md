## Domain: Telemetry

---

### Issue [Feature] Trigger Anomaly Evaluation engine dynamically on Telemetry ingestion

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Anomalies are detected via offline script triggers. We need them created in real-time as sensor streams are received.
- **Implementation:** Call `detectAnomaly` service within the telemetry ingestion flow.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] If temperature exceeds limits, anomaly record is saved immediately.
- [ ] Emit anomaly socket warning to live dashboards.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Post bad telemetry and assert immediate generation of anomaly in database.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-27-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
