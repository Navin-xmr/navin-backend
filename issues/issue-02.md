## Domain: Infrastructure

---

### Issue [Optimization] Configure Helmet security headers for Dev Weak ETags

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Helmet is active in `src/app.ts`, but its default headers can block inline assets or collide with browser caching for weak ETags in dev mode.
- **Implementation:** Adjust the `helmet()` middleware instantiation inside `src/app.ts` to support relaxed Content Security Policies during development.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Helmet is loaded with a customized CSP object.
- [ ] Local developer styles and devtools work without CSP errors.
- [ ] Production headers remain highly secure.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Check response headers for helmet directives in development mode.
- [ ] Confirm weak ETag headers are not stripped by reverse proxies.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-02-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
