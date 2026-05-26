## Domain: Identity

---

### Issue [Feature] Auto-assign default user role during manual signup

**Tier:** 🟢 Easy

**Description:**
- **Problem:** The signup service `auth.service.ts` always hardcodes `UserRole.VIEWER`. New organizational admins registering need standard admin roles.
- **Implementation:** Update `signup()` in `auth.service.ts` to accept a role or evaluate email domains to dynamically assign permissions.

**Dependencies:**
- Depends on issue-05.md

**Acceptance Criteria:**
- [ ] If email domain matches internal admin lists, assign ADMIN role.
- [ ] Standard registrations default to VIEWER securely.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert user role matches expectations inside `auth.service.test.ts`.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-07-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
