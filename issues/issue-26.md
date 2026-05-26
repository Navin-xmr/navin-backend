## Domain: Telemetry

---

### Issue [Security] Validate user role authorization for Anomaly resolution

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Any authenticated user can patch anomalies to resolved status, but business rules dictate only Admins/Managers can authorize this.
- **Implementation:** Integrate `requireRole(UserRole.ADMIN, UserRole.MANAGER)` to `/api/anomalies/:id/resolve` route guard.

**Dependencies:**
- Depends on issue-25.md

**Acceptance Criteria:**
- [ ] Viewer or Customer tokens receive HTTP 403 Forbidden on resolution attempt.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert 403 responses for restricted tokens.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-26-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
