## Domain: Telemetry

---

### Issue [Feature] Real-time Telemetry broadcasts over Socket.io

**Tier:** 🔴 Hard

**Description:**
- **Problem:** Frontend charts require real-time dashboard plotting, but backend only records sensor telemetry in database without live triggers.
- **Implementation:** Hook Socket.io instance to broadcast event packets to designated shipment rooms inside the telemetry controller.

**Dependencies:**
- Depends on None

**Acceptance Criteria:**
- [ ] Websocket clients can join `shipment:<id>` rooms.
- [ ] Emits `sensor_update` JSON events immediately on post.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Write Socket client simulation tests to capture broadcast events.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-21-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
