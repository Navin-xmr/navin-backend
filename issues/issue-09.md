## Domain: Identity

---

### Issue [Optimization] Optimize Redis Token Blocklist index parameters

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Revoked tokens in the Redis blocklist are not optimized for rapid TTL matching during route authorization checks in `requireAuth.ts`.
- **Implementation:** Refactor standard Redis token blocklist prefixing and key expiry timers in `tokenBlocklist.ts`.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Tokens are stored with strict UUID prefixes.
- [ ] Revocation checks complete in less than 2ms.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Profile token validation times using console timers.
- [ ] Unit test blocklist addition and retrieval.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-09-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
