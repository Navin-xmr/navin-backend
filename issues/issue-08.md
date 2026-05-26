## Domain: Identity

---

### Issue [Feature] Login Rate Limiter custom cooldown headers

**Tier:** 🟡 Medium

**Description:**
- **Problem:** When a login rate limit triggers in `loginLimiter`, the client receives a raw text block without knowing how long they should wait.
- **Implementation:** Override rate limiter callbacks to return standard JSON error structures with a `retryAfter` field indicating cooldown time.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Login limit responds with JSON body containing `{ success: false, retryAfter: number }`.
- [ ] Returns `429 Too Many Requests` status.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Trigger rate limiter via concurrent failed login requests.
- [ ] Assert response envelope matches standard API envelopes.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-08-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
