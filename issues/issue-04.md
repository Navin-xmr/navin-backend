## Domain: Infrastructure

---

### Issue [Feature] Inject Request ID in HTTP response headers

**Tier:** 🟢 Easy

**Description:**
- **Problem:** We have `requestId()` middleware in `src/app.ts`, but the generated Request ID is only logged on the server side, not returned to the frontend.
- **Implementation:** Update `requestId.ts` middleware or the main app entry to append `X-Request-ID` header to all outgoing responses.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] All HTTP responses contain `X-Request-ID` header.
- [ ] Frontend can extract and print request IDs in error console messages.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Perform HTTP requests and check for the presence of the `X-Request-ID` header.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-04-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
