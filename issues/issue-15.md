## Domain: Logistics

---

### Issue [Bug] Make trackingNumber optional in CreateShipment validation

**Tier:** 🟢 Easy

**Description:**
- **Problem:** The `CreateShipmentBodySchema` in `shipments.validation.ts` has `trackingNumber` as a required field. This blocks the frontend from creating shipments since it expects the server to generate it.
- **Implementation:** Change Zod field type to `.optional()` inside `shipments.validation.ts`.

**Dependencies:**
- Depends on issue-14.md

**Acceptance Criteria:**
- [ ] Zod passes without `trackingNumber` in body payload.
- [ ] Successful shipment creation.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Perform POST requests omitting trackingNumber and verify 201 OK response.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-15-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
