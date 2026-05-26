## Domain: Logistics

---

### Issue [Feature] Integrate automatic Shipment Tracking Number generation

**Tier:** 🟢 Easy

**Description:**
- **Problem:** The shipment creation logic depends on the client specifying the tracking number. We need an auto-generation fallback in case it is omitted.
- **Implementation:** Implement generator logic `NVN-XXXXXX` inside the creation service wrapper in `shipments.service.ts`.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] If `trackingNumber` is absent in request, generate unique code.
- [ ] Saves tracking number to Mongoose schema.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Verify generated format in Mongoose models via unit tests.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-14-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
