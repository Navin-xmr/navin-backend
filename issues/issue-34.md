## Domain: Identity

---

### Issue [Feature] Token-based User Invitation links generation

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Admins need to invite team members securely instead of manually registering passwords.
- **Implementation:** Build secure invitation routes that email sign-up tokens linked to designated roles and organizations.

**Dependencies:**
- Depends on issue-33.md

**Acceptance Criteria:**
- [ ] Token validates organization bindings.
- [ ] Invite links expire in 48 hours.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert invite token verification in service unit tests.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-34-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
