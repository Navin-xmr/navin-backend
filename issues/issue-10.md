## Domain: Identity

---

### Issue [Feature] Standardize HTTP 401 response envelopes in Error Middleware

**Tier:** 🟢 Easy

**Description:**
- **Problem:** When a route guard throws `AppError(401, ...)`, the structure can miss metadata like error codes, causing parsing bugs in frontend interceptors.
- **Implementation:** Update `errorMiddleware.ts` to guarantee a clean JSON payload mapping for all unauthorized responses.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] 401 response uses standard `{ success: false, message, data: null }`.
- [ ] Include a distinct `errorCode: "UNAUTHORIZED"` parameter in the body.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Query a protected endpoint without an Authorization header.
- [ ] Assert the returned envelope fits requirements.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-10-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
