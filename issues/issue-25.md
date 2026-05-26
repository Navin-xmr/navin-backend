## Domain: Telemetry

---

### Issue [Bug] Align Anomalies GET API response pagination envelope

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Frontend expects `res.data` to hold the keys `data`, `nextCursor`, and `hasMore` for anomalies listing. The backend `getAnomalies` controller nests them inside `{ success, message, data, meta }`, breaking client list parsing.
- **Implementation:** Modify the anomaly controller to skip standard wrapper and return flat properties, or modify the wrapper call.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] GET `/api/anomalies` response matches exact frontend `PaginatedAnomalies` schema.
- [ ] No frontend parse errors.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert returned keys match expectation.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-25-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
