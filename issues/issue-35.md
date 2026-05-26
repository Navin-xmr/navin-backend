## Domain: Identity

---

### Issue [Security] Strict organization assignment on Team user creation

**Tier:** 🟡 Medium

**Description:**
- **Problem:** When a Manager creates a new team member via `POST /api/users`, they could manually set an incorrect organization ID.
- **Implementation:** Force override `organizationId` parameter in the user creation service using the caller's JWT token metadata.

**Dependencies:**
- Depends on issue-33.md

**Acceptance Criteria:**
- [ ] Admins cannot create users outside their own company.
- [ ] Secured organization binding.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Try posting different organization parameters and assert strict override.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-35-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
