## Domain: Infrastructure

---

### Issue [Refactor] CORS Credentials configuration in cors.ts

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Frontend Axios client utilizes `withCredentials: true` but the backend `src/config/cors.ts` delegate only returns `{ origin: true }`. This causes browsers to reject pre-flight requests with CORS blocks.
- **Implementation:** Modify the `corsOptionsDelegate` inside `src/config/cors.ts` to return `{ origin: true, credentials: true }` for both empty origin requests and allowed domains.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] CORS options object returned by corsOptionsDelegate contains `credentials: true`.
- [ ] Outgoing browser pre-flight checks are accepted successfully by the client.
- [ ] Integration verified against multiple domains.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Write unit tests for `corsOptionsDelegate` checking if `credentials` is present.
- [ ] Verify locally using curl with custom origin headers.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-01-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
