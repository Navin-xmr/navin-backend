## Domain: Infrastructure

---

### Issue [Feature] Standard Rate Limiter parameters tuning

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Current rate limiter in `src/shared/middleware/rateLimiter.ts` has low window limits that can trigger early 429 errors under fast dashboard polling.
- **Implementation:** Tune standard limits to accept higher throughput for trusted authenticated calls while keeping tight bounds on public auth routes.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Standard rate limiter allows up to 100 requests per minute in dev.
- [ ] Authenticated tokens bypass public rate limit tiers.
- [ ] Standard JSON error response returned when limit is exceeded.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Simulate 100+ concurrent requests using load testing scripts.
- [ ] Verify `X-RateLimit-*` headers are present in response.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-03-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
