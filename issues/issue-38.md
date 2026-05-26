## Domain: Settlements

---

### Issue [Feature] Synchronize payment statuses via Stellar Webhook handlers

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Payment records must synchronize automatically when transactions complete on the blockchain network.
- **Implementation:** Integrate webhook callbacks to listen to Stellar bridge channels and update database payment statuses.

**Dependencies:**
- Depends on issue-36.md

**Acceptance Criteria:**
- [ ] When release event is captured, update status to 'Released' in Mongo.
- [ ] Audit log recorded successfully.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Simulate webhook triggers with sample Stellar event payloads.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-38-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
