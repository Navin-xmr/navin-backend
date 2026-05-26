## Domain: Identity

---

### Issue [Feature] Enrich JWT Payload with Organization Type

**Tier:** 🟡 Medium

**Description:**
- **Problem:** The frontend needs to know whether the user belongs to a `LOGISTICS` carrier or an `ENTERPRISE` shipper to load correct dashboards. Extracting this requires a separate profile query.
- **Implementation:** Fetch the user's organization in `auth.service.ts` and embed `organizationType` inside the JWT payload signature.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] JWT token claims include `organizationType`.
- [ ] Frontend can instantly route users based on decoded client-side tokens.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Decode token in unit tests and verify `organizationType` value.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-11-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
