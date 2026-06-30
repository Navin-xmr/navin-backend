#306 [API-QA] Create centralized error code registry documentation
Repo Avatar
Navin-xmr/navin-backend
Issue [API-QA] Create centralized error code registry documentation
Tier: 🟡 Medium

Description:

Problem: The API_DOCUMENTATION_REVIEW.html audit identifies "No Centralized Error Code Documentation" as a critical bottleneck (#2). Error codes like ERR_AUTH_INVALID, ERR_PERMISSION_DENIED, ERR_SHIPMENT_NOT_FOUND etc. are defined in src/shared/http/errors.ts but never documented for external consumers. Frontend developers must reverse-engineer error handling from test files. The Swagger spec has no components/schemas section defining error codes.
Implementation: (1) Add a docs/ERROR_CODES.md that lists every error code with: HTTP status, code string, human description, and which endpoints can return it. (2) Add a components/schemas/ErrorCodes enum in swagger.yaml. (3) Add JSDoc to errors.ts explaining each code. This is a documentation-only change — do not modify error handling logic.
Dependencies:

Depends on None
Acceptance Criteria:

 docs/ERROR_CODES.md exists with a table of all error codes.
 Each entry includes: HTTP status, error code, description, example endpoint(s).
 Swagger components/schemas includes an ErrorCodes enum definition.
 JSDoc added to ErrorCodes object in errors.ts documenting each code.
 Frontend team can use this as a reference for error handling.
 No logic changes — documentation only.
Testing Requirements:

 Verify error codes in documentation match errors.ts (no stale entries).
 npm run build passes.
 YAML linting passes on swagger.yaml.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-XXX-error-code-registry).
 npm run lint and npm run build pass with zero warnings.
 No logic changes — documentation only.

 #307 [API-QA] Expand README.md with comprehensive API quickstart guide
Repo Avatar
Navin-xmr/navin-backend
Issue [API-QA] Expand README.md with comprehensive API quickstart guide
Tier: 🟡 Medium

Description:

Problem: The AUDIT_REPORT_API_DOCUMENTATION.html audit (finding #3 "README.md Documentation Gaps") identifies that the README only lists 2 example endpoints and is missing: API authentication guide, error code documentation, pagination explanation, real-time features docs, webhook documentation, and response envelope explanation. New developers have no quickstart path. The README/Developer Guide dimension scores only 15% in the API_DOCUMENTATION_REVIEW.html quality meter.
Implementation: Expand README.md with sections: (1) Quick Start (clone, install, env setup, run), (2) Authentication (JWT Bearer flow, API keys), (3) Response Envelope format with example, (4) Pagination (cursor vs offset with examples), (5) Error Handling (link to error codes doc), (6) Real-time (Socket.IO link), (7) Available Endpoints (grouped by module with method+path), (8) Environment Variables table.
Dependencies:

Depends on None
Acceptance Criteria:

 README includes Authentication section with JWT flow and example curl.
 README includes Response Envelope section with JSON example.
 README includes Pagination section explaining both patterns.
 README includes table of all available endpoints grouped by module.
 README includes Environment Variables section with required vs optional.
 Quick Start section allows a new developer to run the API in < 5 minutes.
 No code changes — documentation only.
Testing Requirements:

 Follow the quickstart instructions on a fresh clone to verify accuracy.
 Verify endpoint table matches actual routes (cross-reference route files).
 npm run build passes.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-XXX-readme-expansion).
 npm run lint and npm run build pass with zero warnings.
 No code changes — documentation only.

 #308 [API-QA] Add security declarations to all authenticated Swagger endpoints
Repo Avatar
Navin-xmr/navin-backend
Issue [API-QA] Add security declarations to all authenticated Swagger endpoints
Tier: 🟢 Easy

Description:

Problem: The API_DOCUMENTATION_REVIEW.html audit (finding H-02) identifies multiple endpoints that use requireAuth middleware in their route files but have no security: block in Swagger. This means code-generated clients will not include auth headers, and security scanners will not flag these endpoints as requiring authentication. Affected: GET /api/shipments, PATCH /api/shipments/:id, GET /api/telemetry, and all missing endpoints.
Implementation: Add security: [{ bearerAuth: [] }] to every protected path operation in docs/swagger.yaml. Alternatively, add a global security: block at the top level and explicitly opt out with security: [] only on public endpoints (/api/health, /api/auth/signup, /api/auth/login, /api/users/invitations/verify, /api/users/invitations/accept).
Dependencies:

Depends on None
Acceptance Criteria:

 Every endpoint with requireAuth in route file has security: [{ bearerAuth: [] }] in Swagger.
 Public endpoints explicitly marked with security: [] or left without security block.
 Role-restricted endpoints documented with x-required-role extension or description.
 403 response documented on all role-restricted endpoints.
 Swagger UI "Authorize" button works correctly for all endpoints.
Testing Requirements:

 YAML linting passes.
 Swagger UI shows lock icon on all authenticated endpoints.
 Cross-reference every route file to verify security alignment.
 npm run build passes.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-XXX-swagger-security).
 npm run lint and npm run build pass with zero warnings.
 No code changes — documentation only.

 #312 [API-QA] Fix internal documentation conflicts between Swagger and compatibility guide
Repo Avatar
Navin-xmr/navin-backend
Issue [API-QA] Fix internal documentation conflicts between Swagger and compatibility guide
Tier: 🟢 Easy

Description:

Problem: The API_DOCUMENTATION_REVIEW.html audit (finding M-04) identifies that backend-compatibility-guide-check.md contains factually incorrect statements that contradict the Swagger spec and actual route files. Specifically, section 8.6 states "The backend has a users module but only defines POST /api/users and DELETE /api/users/:id, with no GET /api/users route" — this is wrong, GET /api/users exists in both Swagger and users.routes.ts. When internal docs contradict each other, developers lose trust in ALL documentation.
Implementation: Audit backend-compatibility-guide-check.md and correct all factually incorrect statements. Cross-reference against actual route files and Swagger spec. Remove or update stale claims. Add a note at the top indicating the document's last-verified date. Consider adding a simple script that auto-generates the endpoint list from route files to prevent future drift.
Dependencies:

Depends on None
Acceptance Criteria:

 All factual inaccuracies in backend-compatibility-guide-check.md corrected.
 Endpoint claims match actual route files (verified against *.routes.ts).
 Document has a "Last verified" date stamp.
 No contradictions between this document and docs/swagger.yaml.
 No code changes — documentation corrections only.
Testing Requirements:

 Cross-reference every endpoint claim in the guide against source route files.
 Verify against Swagger spec for consistency.
 npm run build passes.
PR Checklist:

 Branch is named conventionally (e.g., docs/issue-XXX-fix-compat-guide).
 npm run lint and npm run build pass with zero warnings.
 No code changes — documentation only.