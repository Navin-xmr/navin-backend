## Domain: Settlements

---

### Issue [Feature] Define Payments Mongoose database Schema

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Payments History page in frontend is fully mocked. Backend lacks the data models to store, track, and serve billing records.
- **Implementation:** Create `Payment` database model with fields: id, date, amount, token type, status (Escrowed, Released, etc.), and txnHash.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Model compiles successfully with strict TypeScript declarations.
- [ ] Status field restricts to 'Pending' | 'Escrowed' | 'Released' | 'Failed'.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Verify schema constraints and validations.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-36-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
