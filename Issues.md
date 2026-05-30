Description:

Problem: GET /api/health is a public route wired in src/app.ts but is not listed in docs/swagger.yaml. It is the first endpoint any DevOps engineer or load balancer will hit, yet it has no documented contract.
Implementation: Add an OpenAPI path definition for GET /api/health under paths:. Document the 200 response shape (uptime, timestamp, status fields) and note that it is public (no security block).
Dependencies:

Depends on None
Acceptance Criteria:

 GET /api/health present in docs/swagger.yaml.
 No security block attached (public endpoint).
 200 response schema documents all fields returned by the health controller.
Testing Requirements:

 Swagger UI renders the health path without YAML syntax errors.
 npm run build passes with zero warnings.
 Response fields match src/modules/health/health.controller.ts.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-61-health-swagger).
 npm run lint and npm run build pass with zero warnings.

.................................................................
Description:

Problem: GET /api/analytics and GET /api/payments are registered in src/app.ts but have no representation in docs/swagger.yaml. These are critical BI and settlement interfaces.
Implementation: Add OpenAPI path definitions for both routes. Analytics should cover aggregation params (groupBy, dateRange). Payments should cover status filters and pagination.
Dependencies:

Depends on None
Acceptance Criteria:

 GET /api/analytics documented with query params and aggregation response schema.
 GET /api/payments documented with query params (status, page, limit) and response schema.
 Both endpoints declare security: [bearerAuth: []].
 Response shapes match actual controller return values.
Testing Requirements:

 Swagger UI renders new paths without YAML syntax errors.
 npm run build passes with zero warnings.
 Controller audit list attached to PR.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-60-analytics-payments-swagger).
 npm run lint and npm run build pass with zero warnings.
 .......................................................
 Description:

Problem: GET /api/telemetry and GET /api/anomalies are wired in src/app.ts but completely missing from docs/swagger.yaml. Consumers have no documented contract for querying telemetry time-series or anomaly alerts.
Implementation: Add OpenAPI path definitions for both endpoints. Telemetry should document query filters (shipmentId, date range, pagination). Anomalies should document severity/type filters.
Dependencies:

Depends on None
Acceptance Criteria:

 GET /api/telemetry documented with query params (shipmentId, from, to, page, limit).
 GET /api/anomalies documented with query params (shipmentId, severity, type, resolved).
 Both endpoints declare security: [bearerAuth: []].
 Response schemas reference or extend the existing Anomaly component schema.
Testing Requirements:

 Swagger UI renders new paths without YAML syntax errors.
 npm run build passes with zero warnings.
 Parameters verified against actual controller query parsing logic.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-59-telemetry-anomalies-swagger).
 npm run lint and npm run build pass with zero warnings.
 .................................................................
 Description:

Problem: The rate limiter middleware in src/shared/middleware/rateLimiter.ts line 17 uses a skip function that checks for the presence of a Bearer prefix in the Authorization header:

skip: hasAuthenticatedBearerToken,
The hasAuthenticatedBearerToken function only validates the header format (starts with Bearer ), not whether the token is actually valid. An attacker can bypass rate limiting on all endpoints by sending any request with Authorization: Bearer fake-token-here. This defeats the purpose of rate limiting for brute-force protection on login and other sensitive endpoints.

Implementation:

Remove the skip logic from the rate limiter entirely, OR
Apply separate rate limiters: a strict one for unauthenticated routes (login, signup) and a relaxed one for authenticated routes. The authentication check should happen via requireAuth middleware before determining rate limit tiers, not via a header format check.
If differentiated rate limits are needed, use the validated req.user property (set by requireAuth) rather than raw header inspection.
Dependencies:

Depends on None
Acceptance Criteria:

 Requests with invalid Bearer tokens are rate-limited normally.
 Only requests that pass full JWT verification can qualify for relaxed rate limits (if applicable).
 Login endpoint remains protected by rate limiting regardless of headers.
 Proper HTTP status codes and our standard JSON response wrapper are used.
 Edge cases (e.g., missing data, unauthorized roles) are handled gracefully.
Testing Requirements:

 Add test: request with Authorization: Bearer invalid is still rate-limited.
 Add test: rapid login attempts trigger rate limit (429).
 Run login-rate-limit.test.ts to confirm no regressions.
 Unit tests written for the core logic (target 80%+ coverage).
 External API calls or database connections are mocked in unit tests.
 Postman collection or Swagger spec updated (if this adds/modifies an endpoint).
PR Checklist:

 Branch is named conventionally (e.g., security/issue-53-rate-limiter-bypass).
 npm run lint and npm run build pass with zero warnings.
 Screenshot of passing Jest terminal logs is attached to the PR.
 Database migrations/seed scripts updated (if applicable).