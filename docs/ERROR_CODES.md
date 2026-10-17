# Navin API Error Codes Registry

This document provides a comprehensive registry of all error codes used by the Navin Backend API. External consumers (frontend, third-party clients) can use this reference to implement proper error handling.

## Error Code Format

All error codes follow the naming convention: `ERR_<DOMAIN>_<DESCRIPTION>` or `ERR_<DESCRIPTION>`

## Error Codes Table

| HTTP Status | Error Code | `ErrorCodes` Key(s) | Description | Example Endpoints | When Returned |
|---|---|---|---|---|---|
| **400** | `ERR_BAD_REQUEST` | `BAD_REQUEST` | Invalid request syntax or parameters | All endpoints | Malformed JSON body, invalid query parameters |
| **400** | `VALIDATION_ERROR` | *(middleware)* | Request validation failed (Zod middleware) | All validated endpoints | `validateRequest` in `src/shared/validation/validate.ts` rejects `req.body`, `req.query`, or `req.params` |
| **400 / 422** | `ERR_VALIDATION_FAILED` | `VALIDATION_ERROR` | Domain / model validation failed | All endpoints | Service-level validation failure (400) or Mongoose `ValidationError` (422) |
| **400** | `ERR_AUTH_INVALID_RESET_TOKEN` | `INVALID_RESET_TOKEN` | Invalid or expired password reset token | `POST /api/auth/reset-password` | Reset token is missing, malformed, or expired |
| **400** | `ERR_AUTH_INVALID_TOKEN_IDENTIFIER` | `TOKEN_INVALID_IDENTIFIER` | Invalid JWT `jti` identifier | `POST /api/auth/logout` | Token `jti` is not a valid UUID v4 (#703) |
| **400** | `ERR_AUTH_2FA_NOT_SETUP` | `TOTP_NOT_SETUP` | TOTP 2FA not set up | `POST /api/auth/2fa/verify-setup` | User has not initiated TOTP enrollment |
| **400** | `ERR_AUTH_2FA_NOT_ENABLED` | `TOTP_NOT_ENABLED` | TOTP 2FA is not enabled | `POST /api/auth/2fa/disable`, `POST /api/auth/2fa/backup-codes/regenerate` | Operation requires TOTP 2FA to be enabled on the account |
| **400 / 409** | `ERR_SHIPMENT_INVALID_TRANSITION` | `SHIPMENT_INVALID_TRANSITION`, `INVALID_TRANSITION` | Invalid shipment status transition | `PATCH /api/shipments/:id/status` | Requested status transition violates the shipment state machine |
| **400** | `ERR_STELLAR_INVALID_HASH` | `STELLAR_INVALID_HASH` | Invalid Stellar hash | Ledger / anchor endpoints | Provided hash is not a valid 64-char hex SHA-256 digest |
| **400** | `ERR_PHOTO_LIMIT_EXCEEDED` | `PHOTO_LIMIT_EXCEEDED` | Photo upload limit exceeded | `POST /api/shipments/:id/photos` | Maximum number of photos for the shipment has been reached |
| **401** | `ERR_AUTH_INVALID` | `UNAUTHORIZED` | Missing or invalid authentication token | All protected endpoints | Missing `Authorization` header, malformed JWT, expired token, or invalid credentials |
| **401** | `ERR_AUTH_TOKEN_REVOKED` | `TOKEN_REVOKED` | JWT has been explicitly revoked | All protected endpoints, `GET /api/events` | User logged out; token blocklisted in Redis before natural expiry |
| **401** | `ERR_AUTH_2FA_INVALID_CODE` | `TOTP_INVALID_CODE` | Invalid TOTP 2FA code | `POST /api/auth/2fa/verify`, `POST /api/auth/2fa/verify-setup` | Submitted 6-digit TOTP code did not match |
| **401** | `ERR_AUTH_2FA_INVALID_BACKUP_CODE` | `TOTP_INVALID_BACKUP_CODE` | Invalid 2FA backup code | `POST /api/auth/2fa/verify` | Submitted recovery backup code did not match or was already consumed |
| **403** | `ERR_PERMISSION_DENIED` | `FORBIDDEN` | Insufficient role permissions | All role-restricted endpoints | User role not authorized for this endpoint or CORS origin denied |
| **403** | `ERR_CHAIN_UNAUTHORIZED` | `CHAIN_UNAUTHORIZED` | On-chain signer unauthorized | Settlement / anchor chain calls | Soroban contract `NotAuthorized` (1) |
| **404** | `ERR_NOT_FOUND` | `NOT_FOUND` | Resource not found | `GET /api/*/:id`, `PATCH /api/*/:id`, `DELETE /api/*/:id` | Generic resource ID does not exist or route not found |
| **404** | `ERR_SHIPMENT_NOT_FOUND` | `SHIPMENT_NOT_FOUND` | Shipment resource not found | `GET /api/shipments/:id`, `PATCH /api/shipments/:id` | Shipment ID does not exist |
| **404** | `ERR_PAYMENT_NOT_FOUND` | `PAYMENT_NOT_FOUND` | Payment resource not found | `GET /api/payments/:id` | Payment ID does not exist |
| **404** | `ERR_SETTLEMENT_NOT_FOUND` | `SETTLEMENT_NOT_FOUND` | Settlement resource not found | `GET /api/settlements/:id`, `POST /api/settlements/:id/*` | Settlement ID does not exist |
| **404** | `ERR_ORGANIZATION_NOT_FOUND` | `ORGANIZATION_NOT_FOUND` | Organization resource not found | `GET /api/organizations/:id`, `PATCH /api/organizations/:id` | Organization ID does not exist |
| **404** | `ERR_TEMPLATE_NOT_FOUND` | `TEMPLATE_NOT_FOUND` | Shipment template not found | `GET /api/shipment-templates/:id`, `DELETE /api/shipment-templates/:id` | Shipment template ID does not exist |
| **404** | `ERR_LEDGER_BLOCK_NOT_FOUND` | `LEDGER_BLOCK_NOT_FOUND` | Ledger block resource not found | `GET /api/ledger/blocks/:id`, `GET /api/ledger/blocks/:id/verification` | Ledger block ID does not exist |
| **404** | `ERR_NOTIFICATION_NOT_FOUND` | `NOTIFICATION_NOT_FOUND` | Notification resource not found | `PATCH /api/notifications/:id/read`, `DELETE /api/notifications/:id` | Notification ID does not exist |
| **404** | `ERR_CHAIN_ESCROW_NOT_FOUND` | `CHAIN_ESCROW_NOT_FOUND` | On-chain escrow not found | Settlement escrow chain calls | Soroban contract `EscrowNotFound` (5) |
| **409** | `ERR_DUPLICATE_KEY` | `DUPLICATE_KEY` | Unique constraint violation | `POST /api/auth/signup`, `POST /api/users` | Email already registered or duplicate unique field value |
| **409** | `ERR_SETTLEMENT_ALREADY_DISPUTED` | `SETTLEMENT_ALREADY_DISPUTED` | Settlement already disputed | `POST /api/settlements/:id/dispute` | Settlement is already in `DISPUTED` status |
| **409** | `ERR_AUTH_2FA_ALREADY_ENABLED` | `TOTP_ALREADY_ENABLED` | TOTP 2FA already enabled | `POST /api/auth/2fa/setup` | TOTP 2FA is already enabled on the user account |
| **409** | `ERR_CHAIN_ALREADY_ANCHORED` | `CHAIN_ALREADY_ANCHORED` | Milestone already anchored on-chain | Milestone anchor chain calls | Soroban contract `AlreadyAnchored` (3) |
| **409** | `ERR_CHAIN_ESCROW_EXISTS` | `CHAIN_ESCROW_EXISTS` | On-chain escrow already exists | Escrow creation chain calls | Soroban contract `EscrowExists` (4) |
| **409** | `ERR_CHAIN_ESCROW_ALREADY_RELEASED` | `CHAIN_ESCROW_ALREADY_RELEASED` | On-chain escrow already released | Escrow release/refund chain calls | Soroban contract `EscrowAlreadyReleased` (6) |
| **413** | `ERR_FILE_TOO_LARGE` | `FILE_TOO_LARGE` | Uploaded file exceeds size limit | Upload endpoints | Multer `LIMIT_FILE_SIZE` or storage cap exceeded |
| **415** | `ERR_INVALID_MIME_TYPE` | `INVALID_MIME_TYPE` | Unsupported file MIME type | Upload endpoints | Uploaded file MIME type is not allowed |
| **415** | `ERR_INVALID_DOCUMENT_TYPE` | `INVALID_DOCUMENT_TYPE` | Unsupported document type | Document upload endpoints | Uploaded document category/type is not allowed |
| **422** | `ERR_CHAIN_INVALID_HASH` | `CHAIN_INVALID_HASH` | On-chain hash rejected | Chain anchor calls | Soroban contract `InvalidHash` (2) |
| **422** | `ERR_CHAIN_INVALID_AMOUNT` | `CHAIN_INVALID_AMOUNT` | On-chain escrow amount invalid | Escrow creation chain calls | Soroban contract `InvalidAmount` (7) |
| **422** | `ERR_CHAIN_INVALID_PROOF` | `CHAIN_INVALID_PROOF` | On-chain proof invalid | Escrow release chain calls | Soroban contract `InvalidProof` (8) |
| **429** | `ERR_RATE_LIMIT_EXCEEDED` | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded | All rate-limited endpoints | Request rate exceeds configured window limit |
| **500** | `ERR_INTERNAL_SERVER_ERROR` | `INTERNAL_ERROR` | Unhandled server error | All endpoints | Unexpected error in backend processing |
| **500** | `ERR_STELLAR_CONFIG` | `STELLAR_CONFIG` | Invalid Stellar configuration | Stellar / chain services | Required Stellar secret key, network passphrase, or Horizon/Soroban config missing or invalid |
| **500** | `ERR_AUTH_2FA_INVALID_SECRET_FORMAT` | `TOTP_INVALID_SECRET_FORMAT` | Malformed encrypted TOTP secret | `POST /api/auth/2fa/*` | Stored AES-256-GCM TOTP secret payload is corrupted (#702) |
| **502** | `ERR_EVENTS_POLL_FAILED` | `EVENTS_POLL_FAILED` | Redis event store unavailable | `GET /api/events/poll` | Redis read failure during polling fallback |
| **502** | `ERR_FILE_UPLOAD_FAILED` | `FILE_UPLOAD_FAILED` | Storage upload failed | Upload endpoints | Storage provider (S3 / Cloudinary) rejected upload or returned no result (#701) |
| **502** | `ERR_FILE_DELETE_FAILED` | `FILE_DELETE_FAILED` | Storage delete failed | Delete file endpoints | Storage provider (S3 / Cloudinary) rejected delete (#701) |
| **502** | `ERR_CHAIN_UNKNOWN` | `CHAIN_UNKNOWN` | Unmapped on-chain contract error | Chain adapter calls | Soroban contract returned an unknown error code |
| **502** | `ERR_CHAIN_INVALID_EVENT` | `CHAIN_INVALID_EVENT` | Invalid on-chain contract event | Stellar indexer / chain event parser | Indexed contract event payload failed schema validation |

## Error Response Format

All error responses follow this envelope:

```json
{
  "success": false,
  "message": "Human-readable error description",
  "data": null,
  "error": {
    "code": "ERR_CODE_STRING"
  }
}
```

### Example Error Response

**Request:**
```http
POST /api/auth/signup HTTP/1.1
Content-Type: application/json

{
  "email": "invalid-email"
}
```

**Response (400 - Validation Error):**
```json
{
  "success": false,
  "message": "Validation failed: email must be a valid email address",
  "data": null,
  "error": {
    "code": "ERR_VALIDATION_FAILED"
  }
}
```

**Response (409 - Duplicate Key):**
```json
{
  "success": false,
  "message": "User with this email already exists",
  "data": null,
  "error": {
    "code": "ERR_DUPLICATE_KEY"
  }
}
```

## Error Code Index by Domain

### Authentication Errors
- `ERR_AUTH_INVALID` (`UNAUTHORIZED`, 401) — Invalid or missing JWT token
- `ERR_AUTH_TOKEN_REVOKED` (`TOKEN_REVOKED`, 401) — JWT revoked (user logged out; Redis blocklist hit)
- `ERR_AUTH_INVALID_RESET_TOKEN` (`INVALID_RESET_TOKEN`, 400) — Password reset token is invalid or expired
- `ERR_PERMISSION_DENIED` (`FORBIDDEN`, 403) — User lacks required role

### Two-Factor Authentication (2FA) Errors
`ERR_AUTH_2FA_*` — raised by the auth module's TOTP helpers. Clients should not prompt for re-entry on `ERR_AUTH_2FA_INVALID_SECRET_FORMAT`; the stored secret is unreadable and the user must re-enrol.
- `ERR_AUTH_2FA_INVALID_CODE` (`TOTP_INVALID_CODE`, 401) — Submitted TOTP code did not match
- `ERR_AUTH_2FA_NOT_SETUP` (`TOTP_NOT_SETUP`, 400) — TOTP is not configured for this account
- `ERR_AUTH_2FA_ALREADY_ENABLED` (`TOTP_ALREADY_ENABLED`, 409) — TOTP already enabled
- `ERR_AUTH_2FA_NOT_ENABLED` (`TOTP_NOT_ENABLED`, 400) — Operation requires TOTP to be enabled
- `ERR_AUTH_2FA_INVALID_BACKUP_CODE` (`TOTP_INVALID_BACKUP_CODE`, 401) — Backup code did not match
- `ERR_AUTH_2FA_INVALID_SECRET_FORMAT` (`TOTP_INVALID_SECRET_FORMAT`, 500) — Stored TOTP secret is malformed: wrong part count, or an IV/auth tag that does not match AES-256-GCM (#702). Internal integrity failure, not client-fixable.

### Token Blocklist Errors
- `ERR_AUTH_INVALID_TOKEN_IDENTIFIER` (`TOKEN_INVALID_IDENTIFIER`, 400) — Token `jti` is not a UUID v4, so it cannot be blocklisted (#703). Thrown as an `AppError` instead of a bare `Error` from `blocklistKey()`.

### File / Storage Errors
`ERR_FILE_*` — carried on `StorageError.code` by the storage adapters in `src/services/storage/`. `StorageError` also exposes `provider`, `statusCode`, and `originalError`.
- `ERR_FILE_UPLOAD_FAILED` (`FILE_UPLOAD_FAILED`, 502) — Provider rejected the upload, or returned neither an error nor a result (#701)
- `ERR_FILE_DELETE_FAILED` (`FILE_DELETE_FAILED`, 502) — Provider rejected the delete (#701)
- `ERR_FILE_TOO_LARGE` (`FILE_TOO_LARGE`, 413) — Upload exceeds the configured size cap
- `ERR_INVALID_MIME_TYPE` (`INVALID_MIME_TYPE`, 415) — Upload MIME type is not accepted
- `ERR_INVALID_DOCUMENT_TYPE` (`INVALID_DOCUMENT_TYPE`, 415) — Uploaded document type is not accepted
- `ERR_PHOTO_LIMIT_EXCEEDED` (`PHOTO_LIMIT_EXCEEDED`, 400) — Photo count limit reached for this resource

### Shipment, Organization, Template & Notification Resource Errors
- `ERR_NOT_FOUND` (`NOT_FOUND`, 404) — Generic resource not found
- `ERR_SHIPMENT_NOT_FOUND` (`SHIPMENT_NOT_FOUND`, 404) — Specific shipment not found
- `ERR_SHIPMENT_INVALID_TRANSITION` (`SHIPMENT_INVALID_TRANSITION` / `INVALID_TRANSITION`, 400 / 409) — Requested shipment status transition violates the allowed state machine
- `ERR_ORGANIZATION_NOT_FOUND` (`ORGANIZATION_NOT_FOUND`, 404) — Organization resource does not exist
- `ERR_TEMPLATE_NOT_FOUND` (`TEMPLATE_NOT_FOUND`, 404) — Shipment template resource does not exist
- `ERR_NOTIFICATION_NOT_FOUND` (`NOTIFICATION_NOT_FOUND`, 404) — Notification resource does not exist
- `ERR_DUPLICATE_KEY` (`DUPLICATE_KEY`, 409) — Unique constraint violation

### Payment & Settlement Errors
- `ERR_PAYMENT_NOT_FOUND` (`PAYMENT_NOT_FOUND`, 404) — Specific payment resource not found
- `ERR_SETTLEMENT_NOT_FOUND` (`SETTLEMENT_NOT_FOUND`, 404) — Settlement resource does not exist
- `ERR_SETTLEMENT_ALREADY_DISPUTED` (`SETTLEMENT_ALREADY_DISPUTED`, 409) — Settlement is already in `DISPUTED` state (invalid settlement state for duplicate dispute or release)

### Stellar & Ledger Errors
- `ERR_LEDGER_BLOCK_NOT_FOUND` (`LEDGER_BLOCK_NOT_FOUND`, 404) — LedgerBlock record not found for the requested block ID or shipment
- `ERR_STELLAR_CONFIG` (`STELLAR_CONFIG`, 500) — Stellar / Horizon / Soroban environment configuration is missing or invalid
- `ERR_STELLAR_INVALID_HASH` (`STELLAR_INVALID_HASH`, 400) — Provided data hash or transaction hash is malformed (fails SHA-256 hex verification)

### Validation & Rate-Limiting Errors
- `ERR_BAD_REQUEST` (`BAD_REQUEST`, 400) — Malformed request
- `ERR_VALIDATION_FAILED` (`VALIDATION_ERROR`, 400 / 422) — Schema or domain validation failure (note: `validateRequest` middleware emits `VALIDATION_ERROR`)
- `ERR_RATE_LIMIT_EXCEEDED` (`RATE_LIMIT_EXCEEDED`, 429) — Client exceeded the allowed request rate within the configured window

### Events / Real-time Errors
- `ERR_EVENTS_POLL_FAILED` (`EVENTS_POLL_FAILED`, 502) — Redis event store unavailable; polling fallback could not retrieve recent events

### Chain Errors
Mapped from Soroban contract errors by `chainErrorToAppError()` in `src/shared/types/chain.ts` (spec: `docs/chain-interface.md`). Used by the `ChainAdapter` layer (`SimulatedChainAdapter` / `SorobanAdapter`) for on-chain anchoring, payment, and escrow operations (superseding legacy `ERR_STELLAR_ANCHOR_FAILED`, `ERR_STELLAR_TX_FAILED`, `ERR_STELLAR_PAYMENT_FAILED`, `ERR_LEDGER_VERIFICATION_FAILED`, `ERR_SETTLEMENT_INVALID_STATE`, and `ERR_SETTLEMENT_RELEASE_FAILED`).
- `ERR_CHAIN_UNAUTHORIZED` (`CHAIN_UNAUTHORIZED`, 403) — Contract `NotAuthorized` (1): required signer did not authorize
- `ERR_CHAIN_INVALID_HASH` (`CHAIN_INVALID_HASH`, 422) — Contract `InvalidHash` (2)
- `ERR_CHAIN_ALREADY_ANCHORED` (`CHAIN_ALREADY_ANCHORED`, 409) — Contract `AlreadyAnchored` (3)
- `ERR_CHAIN_ESCROW_EXISTS` (`CHAIN_ESCROW_EXISTS`, 409) — Contract `EscrowExists` (4)
- `ERR_CHAIN_ESCROW_NOT_FOUND` (`CHAIN_ESCROW_NOT_FOUND`, 404) — Contract `EscrowNotFound` (5)
- `ERR_CHAIN_ESCROW_ALREADY_RELEASED` (`CHAIN_ESCROW_ALREADY_RELEASED`, 409) — Contract `EscrowAlreadyReleased` (6)
- `ERR_CHAIN_INVALID_AMOUNT` (`CHAIN_INVALID_AMOUNT`, 422) — Contract `InvalidAmount` (7)
- `ERR_CHAIN_INVALID_PROOF` (`CHAIN_INVALID_PROOF`, 422) — Contract `InvalidProof` (8)
- `ERR_CHAIN_UNKNOWN` (`CHAIN_UNKNOWN`, 502) — Contract error code not in the spec (spec drift)
- `ERR_CHAIN_INVALID_EVENT` (`CHAIN_INVALID_EVENT`, 502) — Indexed contract event failed spec validation

### Server Errors
- `ERR_INTERNAL_SERVER_ERROR` (`INTERNAL_ERROR`, 500) — Unhandled exception

## Implementation Details

Error codes are defined in `src/shared/http/errors.ts` with 1-to-1 parity:

```typescript
export const ErrorCodes = {
  UNAUTHORIZED: 'ERR_AUTH_INVALID',
  FORBIDDEN: 'ERR_PERMISSION_DENIED',
  NOT_FOUND: 'ERR_NOT_FOUND',
  BAD_REQUEST: 'ERR_BAD_REQUEST',
  VALIDATION_ERROR: 'ERR_VALIDATION_FAILED',
  INTERNAL_ERROR: 'ERR_INTERNAL_SERVER_ERROR',
  SHIPMENT_NOT_FOUND: 'ERR_SHIPMENT_NOT_FOUND',
  SHIPMENT_INVALID_TRANSITION: 'ERR_SHIPMENT_INVALID_TRANSITION',
  PAYMENT_NOT_FOUND: 'ERR_PAYMENT_NOT_FOUND',
  SETTLEMENT_NOT_FOUND: 'ERR_SETTLEMENT_NOT_FOUND',
  SETTLEMENT_ALREADY_DISPUTED: 'ERR_SETTLEMENT_ALREADY_DISPUTED',
  ORGANIZATION_NOT_FOUND: 'ERR_ORGANIZATION_NOT_FOUND',
  TEMPLATE_NOT_FOUND: 'ERR_TEMPLATE_NOT_FOUND',
  DUPLICATE_KEY: 'ERR_DUPLICATE_KEY',
  INVALID_RESET_TOKEN: 'ERR_AUTH_INVALID_RESET_TOKEN',
  INVALID_TRANSITION: 'ERR_SHIPMENT_INVALID_TRANSITION',
  STELLAR_CONFIG: 'ERR_STELLAR_CONFIG',
  STELLAR_INVALID_HASH: 'ERR_STELLAR_INVALID_HASH',
  CHAIN_UNAUTHORIZED: 'ERR_CHAIN_UNAUTHORIZED',
  CHAIN_INVALID_HASH: 'ERR_CHAIN_INVALID_HASH',
  CHAIN_ALREADY_ANCHORED: 'ERR_CHAIN_ALREADY_ANCHORED',
  CHAIN_ESCROW_EXISTS: 'ERR_CHAIN_ESCROW_EXISTS',
  CHAIN_ESCROW_NOT_FOUND: 'ERR_CHAIN_ESCROW_NOT_FOUND',
  CHAIN_ESCROW_ALREADY_RELEASED: 'ERR_CHAIN_ESCROW_ALREADY_RELEASED',
  CHAIN_INVALID_AMOUNT: 'ERR_CHAIN_INVALID_AMOUNT',
  CHAIN_INVALID_PROOF: 'ERR_CHAIN_INVALID_PROOF',
  CHAIN_UNKNOWN: 'ERR_CHAIN_UNKNOWN',
  CHAIN_INVALID_EVENT: 'ERR_CHAIN_INVALID_EVENT',
  RATE_LIMIT_EXCEEDED: 'ERR_RATE_LIMIT_EXCEEDED',
  LEDGER_BLOCK_NOT_FOUND: 'ERR_LEDGER_BLOCK_NOT_FOUND',
  FILE_TOO_LARGE: 'ERR_FILE_TOO_LARGE',
  INVALID_MIME_TYPE: 'ERR_INVALID_MIME_TYPE',
  INVALID_DOCUMENT_TYPE: 'ERR_INVALID_DOCUMENT_TYPE',
  PHOTO_LIMIT_EXCEEDED: 'ERR_PHOTO_LIMIT_EXCEEDED',
  EVENTS_POLL_FAILED: 'ERR_EVENTS_POLL_FAILED',
  TOKEN_REVOKED: 'ERR_AUTH_TOKEN_REVOKED',
  NOTIFICATION_NOT_FOUND: 'ERR_NOTIFICATION_NOT_FOUND',
  TOTP_INVALID_CODE: 'ERR_AUTH_2FA_INVALID_CODE',
  TOTP_NOT_SETUP: 'ERR_AUTH_2FA_NOT_SETUP',
  TOTP_ALREADY_ENABLED: 'ERR_AUTH_2FA_ALREADY_ENABLED',
  TOTP_NOT_ENABLED: 'ERR_AUTH_2FA_NOT_ENABLED',
  TOTP_INVALID_BACKUP_CODE: 'ERR_AUTH_2FA_INVALID_BACKUP_CODE',
  TOTP_INVALID_SECRET_FORMAT: 'ERR_AUTH_2FA_INVALID_SECRET_FORMAT',
  TOKEN_INVALID_IDENTIFIER: 'ERR_AUTH_INVALID_TOKEN_IDENTIFIER',
  FILE_UPLOAD_FAILED: 'ERR_FILE_UPLOAD_FAILED',
  FILE_DELETE_FAILED: 'ERR_FILE_DELETE_FAILED',
} as const;
```

## Client Implementation Pattern

### JavaScript/TypeScript (Axios)

```typescript
import axios from 'axios';

const client = axios.create({ baseURL: 'http://localhost:3000/api' });

client.interceptors.response.use(
  response => response.data,
  error => {
    const code = error.response?.data?.error?.code ?? error.response?.data?.code;
    if (code === 'ERR_AUTH_INVALID') {
      // Handle authentication error
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    } else if (code === 'ERR_AUTH_TOKEN_REVOKED') {
      // Token was explicitly revoked (e.g. user logged out on another tab/device)
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    } else if (code === 'ERR_PERMISSION_DENIED') {
      // Handle permission error
      console.error('Access denied:', error.response.data.message);
    } else if (code === 'ERR_VALIDATION_FAILED' || code === 'VALIDATION_ERROR') {
      // Handle validation error
      console.error('Validation error:', error.response.data.message);
    }
    throw error;
  }
);
```

### cURL Examples

**401 - Authentication Error:**
```bash
curl -X GET http://localhost:3000/api/shipments
# Response: {"success":false,"message":"Missing or invalid token","data":null,"code":"ERR_AUTH_INVALID"}
```

**403 - Permission Error:**
```bash
curl -X GET http://localhost:3000/api/shipments \
  -H "Authorization: Bearer <viewer_token>"
# Response: {"success":false,"message":"Insufficient permissions","data":null,"code":"ERR_PERMISSION_DENIED"}
```

**400 - Validation Error:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"invalid"}'
# Response: {"success":false,"message":"Validation failed: password is required","data":null,"code":"ERR_VALIDATION_FAILED"}
```

## FAQ

**Q: How do I distinguish between different types of 400 errors?**  
A: Check the `code` field. `ERR_BAD_REQUEST` indicates malformed syntax, while `ERR_VALIDATION_FAILED` (and `VALIDATION_ERROR`) indicates schema violations.

**Q: What should I do when I receive a 500 error?**  
A: Implement exponential backoff retry logic. The error is transient and the backend team has been notified.

**Q: Can I rely on HTTP status codes alone for error handling?**  
A: No. Always check the `code` field for precise error type identification, as multiple logical errors may share the same HTTP status.

**Q: Is the error message localized?**  
A: No. Error messages are currently English only. Frontend teams should map error codes to localized messages.

## Changelog

### Version 1.3.0
- Documented all domain error codes (`ERR_SHIPMENT_INVALID_TRANSITION`, `ERR_SETTLEMENT_NOT_FOUND`, `ERR_SETTLEMENT_ALREADY_DISPUTED`, `ERR_ORGANIZATION_NOT_FOUND`, `ERR_TEMPLATE_NOT_FOUND`, `ERR_AUTH_INVALID_RESET_TOKEN`, `ERR_STELLAR_CONFIG`, `ERR_STELLAR_INVALID_HASH`, `ERR_RATE_LIMIT_EXCEEDED`, `ERR_LEDGER_BLOCK_NOT_FOUND`, `ERR_NOTIFICATION_NOT_FOUND`) for full 1-to-1 parity with `src/shared/http/errors.ts` (#853)

### Version 1.2.0
- Added `ERR_CHAIN_*` codes — chain spec error taxonomy (#650)

### Version 1.1.0
- Added `ERR_AUTH_TOKEN_REVOKED` (401) — revoked JWT error for SSE and all protected endpoints

### Version 1.0.0
- Initial registry with 9 core error codes
- Document created and linked to Swagger components/schemas
