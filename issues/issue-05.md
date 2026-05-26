## Domain: Identity

---

### Issue [Bug] Make organizationId optional in SignupBodySchema validation

**Tier:** 🟢 Easy

**Description:**
- **Problem:** `SignupBodySchema` in `src/modules/auth/auth.validation.ts` defines `organizationId` as a required string. However, the frontend signup form does not collect organization IDs, blocking onboarding.
- **Implementation:** Modify the Zod schema in `src/modules/auth/auth.validation.ts` to make `organizationId` optional.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Signup Zod validation passes without supplying `organizationId`.
- [ ] Existing Mongo schema supports optional organization ID mapping.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Run unit tests on `auth.validation.ts` using empty and populated payloads.
- [ ] Ensure standard 400 Bad Request is returned only for missing email/name/password.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-05-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
