## Domain: Logistics

---

### Issue [Bug] Graceful Storage connection timeout handling in Proof uploads

**Tier:** 🟡 Medium

**Description:**
- **Problem:** A storage upload timeout inside `uploadShipmentProofService` throws unhandled promises that can crash the Express thread.
- **Implementation:** Wrap bucket storage uploads in try-catch structures and trigger clear user error messages instead of throwing.

**Dependencies:**
- Depends on issue-17.md

**Acceptance Criteria:**
- [ ] Graceful HTTP 503 response if storage buckets are offline.
- [ ] Zero server crashes.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Simulate bucket upload failures in integration mocks.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-18-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
