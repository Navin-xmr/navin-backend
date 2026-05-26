## Domain: Identity

---

### Issue [Feature] Align password validation criteria with Frontend strength rules

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Backend validation forces strict minimum length of 6 characters, but frontend encourages strong rules (minimum 8 characters with strength metrics).
- **Implementation:** Upgrade `SignupBodySchema` password constraint in `auth.validation.ts` to mandate a minimum of 8 characters for alignment.

**Dependencies:**
- Depends on issue-05.md

**Acceptance Criteria:**
- [ ] Password lengths less than 8 characters are rejected with a specific Zod message.
- [ ] Signup forms match error boundaries.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Unit test sign-up validation with short and long passwords.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-06-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
