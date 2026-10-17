# Navin API Error Codes Registry

This document provides a comprehensive registry of all error codes used by the Navin Backend API. External consumers (frontend, third-party clients) can use this reference to implement proper error handling.

## Error Code Format

All error codes follow the naming convention: `ERR_<DOMAIN>_<DESCRIPTION>` or `ERR_<DESCRIPTION>`

## Error Codes Table

| HTTP Status | Error Code | Description | Example Endpoints | When Returned |
|---|---|---|---|---|
| **400** | `ERR_BAD_REQUEST` | Invalid request syntax or parameters | All endpoints | Malformed JSON body, invalid query parameters |
| **400** | `VALIDATION_ERROR` | Request validation failed (Zod middleware) | All validated endpoints | `validateRequest` middleware in `src/shared/validation/validate.ts` rejects `req.body`, `req.query`, or `req.params` against a Zod schema |
| **400 / 422** | `ERR_VALIDATION_FAILED` | Domain / model validation failed | All endpoints | Service-level validation via `ErrorCodes.VALIDATION_ERROR` (400) or Mongoose `ValidationError` (422) |
| **401** | `ERR_AUTH_INVALID` | Missing or invalid authentication token | All protected endpoints | Missing `Authorization` header, malformed JWT, expired token |
| **401** | `ERR_AUTH_TOKEN_REVOKED` | JWT has been explicitly revoked | All protected endpoints, `GET /api/events` | User logged out; token blocklisted in Redis before natural expiry |
| **403** | `ERR_PERMISSION_DENIED` | Insufficient role permissions | All role-restricted endpoints | User role not authorized for this endpoint |
| **404** | `ERR_NOT_FOUND` | Resource not found | `GET /api/*/:id`, `PATCH /api/*/:id`, `DELETE /api/*/:id` | Resource ID does not exist or has been deleted |
| **404** | `ERR_SHIPMENT_NOT_FOUND` | Shipment resource not found | `GET /api/shipments/:id`, `PATCH /api/shipments/:id` | Shipment ID does not exist |
| **404** | `ERR_PAYMENT_NOT_FOUND` | Payment resource not found | `GET /api/payments/:id` | Payment ID does not exist |
| **409** | `ERR_DUPLICATE_KEY` | Unique constraint violation | `POST /api/auth/signup`, `POST /api/users` | Email already registered, duplicate field value |
| **429** | `ERR_RATE_LIMIT_EXCEEDED` | Rate limit exceeded | All rate-limited endpoints | Request rate exceeds configured window limit (note: `rateLimiter.ts` emits a `retryAfter` envelope; see [429 Too Many Requests](#429-too-many-requests-rate-limiting)) |
| **500** | `ERR_INTERNAL_SERVER_ERROR` | Unhandled server error | All endpoints | Unexpected error in backend processing |
| **502** | `ERR_EVENTS_POLL_FAILED` | Redis event store unavailable | `GET /api/events/poll` | Redis read failure during polling fallback |

## Error Response Format

Standard application error responses emitted by `errorMiddleware` follow this envelope:

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

**Response (400 - Zod Request Validation Error via `validateRequest`):**
```json
{
  "success": false,
  "message": "{\"message\":\"Validation error\",\"details\":[{\"path\":\"email\",\"message\":\"Invalid email\",\"code\":\"invalid_string\"}]}",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR"
  }
}
```

**Response (400 - Service / Domain Validation Error via `ErrorCodes.VALIDATION_ERROR`):**
```json
{
  "success": false,
  "message": "Validation error",
  "data": null,
  "error": {
    "code": "ERR_VALIDATION_FAILED"
  },
  "details": [
    {
      "path": "email",
      "message": "Invalid email format",
      "code": "invalid_string"
    }
  ]
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

## 429 Too Many Requests (Rate Limiting)

Rate-limited endpoints enforced by `src/shared/middleware/rateLimiter.ts` return HTTP `429 Too Many Requests` along with a `Retry-After` HTTP header (in seconds) and a specialized response envelope containing `retryAfter`:

**Response Headers:**
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 900
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 900
Content-Type: application/json; charset=utf-8
```

**Response Body:**
```json
{
  "success": false,
  "message": "Too many requests, please try again later.",
  "data": null,
  "retryAfter": 900
}
```

### Configured Rate Limiters (`src/shared/middleware/rateLimiter.ts`)

| Limiter | Window | Limit | Applied Routes | `message` |
|---|---|---|---|---|
| `standardLimiter` | 15 min (60s in dev) | 100 req | Global (`app.use(standardLimiter)`) | `"Too many requests, please try again later."` |
| `strictLimiter` | 60s | 10 req | `/api/auth/signup`, `/api/auth/2fa/backup-codes/regenerate`, `/api/public/tracking` | `"Too many requests, please slow down."` |
| `loginLimiter` | 15 min | 5 failed req (`skipSuccessfulRequests: true`) | `/api/auth/login` | `"Too many login attempts, please try again later."` |
| `otpLimiter` | 15 min | 5 req | `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/2fa/verify` | `"Too many OTP requests, please try again later."` |

## Error Code Index by Domain

### Authentication Errors
- `ERR_AUTH_INVALID` (401) — Invalid or missing JWT token
- `ERR_AUTH_TOKEN_REVOKED` (401) — JWT revoked (user logged out; Redis blocklist hit)
- `ERR_PERMISSION_DENIED` (403) — User lacks required role

### Two-Factor Authentication (2FA) Errors
`ERR_AUTH_2FA_*` — raised by the auth module's TOTP helpers. Clients should not prompt for re-entry on these; the stored secret is unreadable and the user must re-enrol.
- `ERR_AUTH_2FA_INVALID_CODE` (401) — Submitted TOTP code did not match
- `ERR_AUTH_2FA_NOT_SETUP` (400) — TOTP is not configured for this account
- `ERR_AUTH_2FA_ALREADY_ENABLED` (409) — TOTP already enabled
- `ERR_AUTH_2FA_NOT_ENABLED` (400) — Operation requires TOTP to be enabled
- `ERR_AUTH_2FA_INVALID_BACKUP_CODE` (401) — Backup code did not match
- `ERR_AUTH_2FA_INVALID_SECRET_FORMAT` (500) — Stored TOTP secret is malformed: wrong part count, or an IV/auth tag that does not match AES-256-GCM (#702). Internal integrity failure, not client-fixable.

### Token Blocklist Errors
- `ERR_AUTH_INVALID_TOKEN_IDENTIFIER` (400) — Token `jti` is not a UUID v4, so it cannot be blocklisted (#703). Thrown as an `AppError` instead of a bare `Error` from `blocklistKey()`.

### File / Storage Errors
`ERR_FILE_*` — carried on `StorageError.code` by the storage adapters in `src/services/storage/`. `StorageError` also exposes `provider`, `statusCode`, and `originalError`.
- `ERR_FILE_UPLOAD_FAILED` (502) — Provider rejected the upload, or returned neither an error nor a result (#701)
- `ERR_FILE_DELETE_FAILED` (502) — Provider rejected the delete (#701)
- `ERR_FILE_TOO_LARGE` (413) — Upload exceeds the configured size cap
- `ERR_INVALID_MIME_TYPE` (415) — Upload MIME type is not accepted
- `ERR_INVALID_DOCUMENT_TYPE` (415) — Uploaded document type is not accepted
- `ERR_PHOTO_LIMIT_EXCEEDED` (400) — Photo count limit reached for this resource

### Resource Errors
- `ERR_NOT_FOUND` (404) — Generic resource not found
- `ERR_SHIPMENT_NOT_FOUND` (404) — Specific shipment not found
- `ERR_PAYMENT_NOT_FOUND` (404) — Specific payment not found
- `ERR_DUPLICATE_KEY` (409) — Unique constraint violation

### Validation Errors
- `ERR_BAD_REQUEST` (400) — Malformed request syntax or payload too large
- `VALIDATION_ERROR` (400) — Request schema validation failure emitted by `validateRequest` in `src/shared/validation/validate.ts` when Zod parsing of `req.body`, `req.query`, or `req.params` fails
- `ERR_VALIDATION_FAILED` (400 / 422) — Service-level validation failure (`ErrorCodes.VALIDATION_ERROR`, 400) or Mongoose model `ValidationError` (422)

### Rate Limiting Errors
- `ERR_RATE_LIMIT_EXCEEDED` (429) — Registered in `ErrorCodes.RATE_LIMIT_EXCEEDED` for programmatic rate-limit `AppError` instances; middleware-level rate limiters in `src/shared/middleware/rateLimiter.ts` return `{ success: false, message, data: null, retryAfter }` with the `Retry-After` header

### Events / Real-time Errors
- `ERR_EVENTS_POLL_FAILED` (502) — Redis event store unavailable; polling fallback could not retrieve recent events
- `ERR_VALIDATION_FAILED` (400) — Schema validation failed

### Chain Errors
Mapped from Soroban contract errors by `chainErrorToAppError()` in `src/shared/types/chain.ts` (spec: `docs/chain-interface.md`). Not yet returned by any endpoint — reserved for the `ChainAdapter` layer (TODO Part 3).
- `ERR_CHAIN_UNAUTHORIZED` (403) — Contract `NotAuthorized` (1): required signer did not authorize
- `ERR_CHAIN_INVALID_HASH` (422) — Contract `InvalidHash` (2)
- `ERR_CHAIN_ALREADY_ANCHORED` (409) — Contract `AlreadyAnchored` (3)
- `ERR_CHAIN_ESCROW_EXISTS` (409) — Contract `EscrowExists` (4)
- `ERR_CHAIN_ESCROW_NOT_FOUND` (404) — Contract `EscrowNotFound` (5)
- `ERR_CHAIN_ESCROW_ALREADY_RELEASED` (409) — Contract `EscrowAlreadyReleased` (6)
- `ERR_CHAIN_INVALID_AMOUNT` (422) — Contract `InvalidAmount` (7)
- `ERR_CHAIN_INVALID_PROOF` (422) — Contract `InvalidProof` (8)
- `ERR_CHAIN_UNKNOWN` (502) — Contract error code not in the spec (spec drift)
- `ERR_CHAIN_INVALID_EVENT` (502) — Indexed contract event failed spec validation

### Server Errors
- `ERR_INTERNAL_SERVER_ERROR` (500) — Unhandled exception

## Implementation Details

Error codes are defined in `src/shared/http/errors.ts`:

```typescript
export const ErrorCodes = {
  UNAUTHORIZED: 'ERR_AUTH_INVALID',
  TOKEN_REVOKED: 'ERR_AUTH_TOKEN_REVOKED',
  FORBIDDEN: 'ERR_PERMISSION_DENIED',
  NOT_FOUND: 'ERR_NOT_FOUND',
  BAD_REQUEST: 'ERR_BAD_REQUEST',
  VALIDATION_ERROR: 'ERR_VALIDATION_FAILED',
  INTERNAL_ERROR: 'ERR_INTERNAL_SERVER_ERROR',
  SHIPMENT_NOT_FOUND: 'ERR_SHIPMENT_NOT_FOUND',
  PAYMENT_NOT_FOUND: 'ERR_PAYMENT_NOT_FOUND',
  DUPLICATE_KEY: 'ERR_DUPLICATE_KEY',
  RATE_LIMIT_EXCEEDED: 'ERR_RATE_LIMIT_EXCEEDED',
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
    const status = error.response?.status;
    const code = error.response?.data?.error?.code ?? error.response?.data?.code;

    if (status === 429) {
      const retryAfter = error.response?.data?.retryAfter ?? Number(error.response?.headers?.['retry-after'] ?? 60);
      console.warn(`Rate limited. Retry after ${retryAfter}s`);
    } else if (code === 'ERR_AUTH_INVALID') {
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
    } else if (code === 'VALIDATION_ERROR' || code === 'ERR_VALIDATION_FAILED') {
      // Handle Zod middleware validation error or service/model validation error
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
# Response: {"success":false,"message":"Missing or invalid token","data":null,"error":{"code":"ERR_AUTH_INVALID"}}
```

**403 - Permission Error:**
```bash
curl -X GET http://localhost:3000/api/shipments \
  -H "Authorization: Bearer <viewer_token>"
# Response: {"success":false,"message":"Insufficient permissions","data":null,"error":{"code":"ERR_PERMISSION_DENIED"}}
```

**400 - Request Validation Error (`validateRequest`):**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"invalid"}'
# Response: {"success":false,"message":"{\"message\":\"Validation error\",\"details\":[...]}","data":null,"error":{"code":"VALIDATION_ERROR"}}
```

**429 - Rate Limit Exceeded (`rateLimiter`):**
```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"wrong"}'
# HTTP/1.1 429 Too Many Requests
# Retry-After: 900
# Response: {"success":false,"message":"Too many login attempts, please try again later.","data":null,"retryAfter":900}
```

## FAQ

**Q: How do I distinguish between different types of 400 errors?**  
A: Check `error.code`. `ERR_BAD_REQUEST` indicates malformed JSON syntax, `VALIDATION_ERROR` is emitted by the `validateRequest` Zod middleware, and `ERR_VALIDATION_FAILED` (`ErrorCodes.VALIDATION_ERROR`) is used by domain services and Mongoose schema validation.

**Q: What should I do when I receive a 500 error?**  
A: Implement exponential backoff retry logic. The error is transient and the backend team has been notified.

**Q: Can I rely on HTTP status codes alone for error handling?**  
A: No. Always check the `code` field for precise error type identification, as multiple logical errors may share the same HTTP status.

**Q: Is the error message localized?**  
A: No. Error messages are currently English only. Frontend teams should map error codes to localized messages.

## Changelog

### Version 1.2.0
- Added `ERR_CHAIN_*` codes — chain spec error taxonomy (#650)

### Version 1.1.0
- Added `ERR_AUTH_TOKEN_REVOKED` (401) — revoked JWT error for SSE and all protected endpoints

### Version 1.0.0
- Initial registry with 9 core error codes
- Document created and linked to Swagger components/schemas
