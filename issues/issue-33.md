## Domain: Identity

---

### Issue [Feature] Build Team Members list REST endpoint GET /api/users

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Frontend Team Management dashboard requires displaying all members of the organization, but backend only defines create and delete routes with no listing endpoint.
- **Implementation:** Add a `GET /` route in `users.routes.ts` that filters users by the authenticated user's `organizationId`.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Lists all users belonging to the caller's company.
- [ ] Protects query with organization isolation.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Seed users across different organizations and assert strict group boundaries.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-33-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
