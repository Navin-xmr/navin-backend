## Domain: Logistics

---

### Issue [Feature] Implement cascade soft-deletion of related Telemetry & Anomalies

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Soft-deleting a shipment via `DELETE /api/shipments/:id` leaves orphan anomalies and telemetry logs in the database.
- **Implementation:** Add post-hooks to soft-deletion service in `shipments.service.ts` to mark associated logs as deleted/archived.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Soft-deleted shipments flag cascade.
- [ ] Queries for anomalies do not return orphans.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert related anomaly counts drop to zero after shipment deletion.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-19-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
