# Navin API Error Codes Registry

This document provides a comprehensive registry of all error codes used by the Navin Backend API. External consumers (frontend, third-party clients) can use this reference to implement proper error handling.

## Error Code Format

All error codes follow the naming convention: `ERR_<DOMAIN>_<DESCRIPTION>` or `ERR_<DESCRIPTION>`

## Error Codes Table

| HTTP Status | Error Code | Description | Example Endpoints | When Returned |
|---|---|---|---|---|
| **400** | `ERR_BAD_REQUEST` | Invalid request syntax or parameters | All endpoints | Malformed JSON body, invalid query parameters |
| **400** | `ERR_VALIDATION_FAILED` | Request validation failed (Zod schema) | All endpoints | Missing required fields, invalid field types, constraints violated |
| **401** | `ERR_AUTH_INVALID` | Missing or invalid authentication token | All protected endpoints | Missing `Authorization` header, malformed JWT, expired token |
| **403** | `ERR_PERMISSION_DENIED` | Insufficient role permissions | All role-restricted endpoints | User role not authorized for this endpoint |
| **404** | `ERR_NOT_FOUND` | Resource not found | `GET /api/*/:id`, `PATCH /api/*/:id`, `DELETE /api/*/:id` | Resource ID does not exist or has been deleted |
| **404** | `ERR_SHIPMENT_NOT_FOUND` | Shipment resource not found | `GET /api/shipments/:id`, `PATCH /api/shipments/:id` | Shipment ID does not exist |
| **404** | `ERR_PAYMENT_NOT_FOUND` | Payment resource not found | `GET /api/payments/:id` | Payment ID does not exist |
| **409** | `ERR_DUPLICATE_KEY` | Unique constraint violation | `POST /api/auth/signup`, `POST /api/users` | Email already registered, duplicate field value |
| **500** | `ERR_INTERNAL_SERVER_ERROR` | Unhandled server error | All endpoints | Unexpected error in backend processing |

## Error Response Format

All error responses follow this envelope:

```json
{
  "success": false,
  "message": "Human-readable error description",
  "data": null,
  "code": "ERR_CODE_STRING"
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
  "code": "ERR_VALIDATION_FAILED"
}
```

**Response (409 - Duplicate Key):**
```json
{
  "success": false,
  "message": "User with this email already exists",
  "data": null,
  "code": "ERR_DUPLICATE_KEY"
}
```

## Error Code Index by Domain

### Authentication Errors
- `ERR_AUTH_INVALID` (401) — Invalid or missing JWT token
- `ERR_PERMISSION_DENIED` (403) — User lacks required role

### Resource Errors
- `ERR_NOT_FOUND` (404) — Generic resource not found
- `ERR_SHIPMENT_NOT_FOUND` (404) — Specific shipment not found
- `ERR_PAYMENT_NOT_FOUND` (404) — Specific payment not found
- `ERR_DUPLICATE_KEY` (409) — Unique constraint violation

### Validation Errors
- `ERR_BAD_REQUEST` (400) — Malformed request
- `ERR_VALIDATION_FAILED` (400) — Schema validation failed

### Server Errors
- `ERR_INTERNAL_SERVER_ERROR` (500) — Unhandled exception

## Implementation Details

Error codes are defined in `src/shared/http/errors.ts`:

```typescript
export const ErrorCodes = {
  UNAUTHORIZED: 'ERR_AUTH_INVALID',
  FORBIDDEN: 'ERR_PERMISSION_DENIED',
  NOT_FOUND: 'ERR_NOT_FOUND',
  BAD_REQUEST: 'ERR_BAD_REQUEST',
  VALIDATION_ERROR: 'ERR_VALIDATION_FAILED',
  INTERNAL_ERROR: 'ERR_INTERNAL_SERVER_ERROR',
  SHIPMENT_NOT_FOUND: 'ERR_SHIPMENT_NOT_FOUND',
  PAYMENT_NOT_FOUND: 'ERR_PAYMENT_NOT_FOUND',
  DUPLICATE_KEY: 'ERR_DUPLICATE_KEY',
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
    if (error.response?.data?.code === 'ERR_AUTH_INVALID') {
      // Handle authentication error
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    } else if (error.response?.data?.code === 'ERR_PERMISSION_DENIED') {
      // Handle permission error
      console.error('Access denied:', error.response.data.message);
    } else if (error.response?.data?.code === 'ERR_VALIDATION_FAILED') {
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
A: Check the `code` field. `ERR_BAD_REQUEST` indicates malformed syntax, while `ERR_VALIDATION_FAILED` indicates schema violations.

**Q: What should I do when I receive a 500 error?**  
A: Implement exponential backoff retry logic. The error is transient and the backend team has been notified.

**Q: Can I rely on HTTP status codes alone for error handling?**  
A: No. Always check the `code` field for precise error type identification, as multiple logical errors may share the same HTTP status.

**Q: Is the error message localized?**  
A: No. Error messages are currently English only. Frontend teams should map error codes to localized messages.

## Changelog

### Version 1.0.0
- Initial registry with 9 core error codes
- Document created and linked to Swagger components/schemas
