## Domain: Logistics

---

### Issue [Bug] Support optional notes field in Proof of Delivery uploads

**Tier:** 🟡 Medium

**Description:**
- **Problem:** Frontend sends custom user `notes` during proof of delivery uploads, but `POST /api/shipments/:id/proof` ignores the notes and only processes signature details.
- **Implementation:** Extend `ShipmentProofBodySchema` in Zod to accept optional `notes` string and update `deliveryProof` schema in Mongoose model to save it.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Proof model holds `notes` field.
- [ ] Proof upload saves notes text correctly.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Upload a multipart file with form-field `notes`. Verify persistence.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-17-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
