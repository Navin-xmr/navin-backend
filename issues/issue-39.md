## Domain: Settlements

---

### Issue [Feature] Expose Stellar transaction explorer URLs formatter utility

**Tier:** 🟢 Easy

**Description:**
- **Problem:** Frontend builds block explorer URLs dynamically, but values (public vs testnet) should be controlled globally by backend environment config.
- **Implementation:** Serve complete explorer links in the payment response schemas according to `STELLAR_NETWORK` environment settings.

**Dependencies:**
- Depends on issue-36.md

**Acceptance Criteria:**
- [ ] Response items contain pre-formatted explorer link strings.
- [ ] Proper HTTP status codes and our standard JSON response wrapper are used.
- [ ] Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.

**Testing Requirements:**
- [ ] Assert URLs match testnet/public explorer endpoints.
- [ ] Unit tests written for the core logic (target 80%+ coverage).
- [ ] External API calls or database connections are mocked in unit tests.
- [ ] Postman collection or Swagger spec updated (if this adds/modifies an endpoint).

**PR Checklist:**
- [ ] Branch is named conventionally (e.g., `feature/issue-39-short-desc`).
- [ ] `npm run lint` and `npm run build` pass with zero warnings.
- [ ] Screenshot of passing Jest terminal logs is attached to the PR.
- [ ] Database migrations/seed scripts updated (if applicable).
