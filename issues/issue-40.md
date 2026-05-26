## Domain: Settlements

---

### Issue [Feature] Automated Escrow release triggers on shipment Delivery confirmation

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Funds held in escrow must release immediately when carriers deliver packages without manual intervention.
- **Implementation:** Trigger Stellar Soroban release contract calls inside the update status service when shipment moves to `DELIVERED`.

**Dependencies:**
- Depends on issue-36.md

**Acceptance Criteria:**
- [ ] On delivery status update, build and execute on-chain release transaction.
- [ ] Record stellar hash to the payment object.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Mock contract client calls in integration tests and check triggers.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-40-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
