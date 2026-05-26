## Domain: Logistics

---

### Issue [Feature] Standardize Milestones timestamp ISO strings serialization

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Milestones timestamps are stored as Date objects in Mongo, but must return as standardized ISO strings to avoid parse bugs in frontend timelines.
- **Implementation:** Configure standard virtual schema getters or customize serialization methods in the `ShipmentSchema` mappings.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Milestones `timestamp` field outputs strictly in ISO string formats.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Check serialized controller outputs for ISO date strings.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-16-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
