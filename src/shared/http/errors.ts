/**
 * @typedef {string} ErrorCode
 * @description Standard error codes returned by the Navin API.
 * All error responses include a `code` field with one of these values.
 * See docs/ERROR_CODES.md for complete documentation and client handling patterns.
 *
 * Error codes follow the naming convention: ERR_<DOMAIN>_<DESCRIPTION>
 */

/**
 * Registry of all error codes used by the Navin Backend API.
 * Each code maps to a specific error condition and HTTP status.
 *
 * @constant
 * @type {Object<string, string>}
 *
 * @property {string} UNAUTHORIZED - 'ERR_AUTH_INVALID' - Returned with 401 status
 *   Indicates missing, expired, or invalid JWT token.
 *   Clients should redirect to login when receiving this code.
 *
 * @property {string} FORBIDDEN - 'ERR_PERMISSION_DENIED' - Returned with 403 status
 *   Indicates user role lacks permission for the requested operation.
 *   Check user role and ensure appropriate authorization level.
 *
 * @property {string} NOT_FOUND - 'ERR_NOT_FOUND' - Returned with 404 status
 *   Generic error for resource not found (generic).
 *   Check resource ID and verify it exists.
 *
 * @property {string} BAD_REQUEST - 'ERR_BAD_REQUEST' - Returned with 400 status
 *   Indicates malformed request syntax or invalid JSON.
 *   Check request format and JSON structure.
 *
 * @property {string} VALIDATION_ERROR - 'ERR_VALIDATION_FAILED' - Returned with 400 status
 *   Indicates Zod schema validation failure (missing/invalid fields, type mismatches).
 *   Check request body against endpoint schema in Swagger docs.
 *
 * @property {string} INTERNAL_ERROR - 'ERR_INTERNAL_SERVER_ERROR' - Returned with 500 status
 *   Indicates unhandled backend exception.
 *   Implement exponential backoff retry logic. Backend team has been notified.
 *
 * @property {string} SHIPMENT_NOT_FOUND - 'ERR_SHIPMENT_NOT_FOUND' - Returned with 404 status
 *   Specific error indicating shipment resource does not exist.
 *   Verify shipment ID and check if it was deleted.
 *
 * @property {string} PAYMENT_NOT_FOUND - 'ERR_PAYMENT_NOT_FOUND' - Returned with 404 status
 *   Specific error indicating payment resource does not exist.
 *   Verify payment ID and check if it was deleted.
 *
 * @property {string} DUPLICATE_KEY - 'ERR_DUPLICATE_KEY' - Returned with 409 status
 *   Indicates unique constraint violation (e.g., email already registered).
 *   Check for duplicate values in request (e.g., email, API key name).
 */
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

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Structured application error class used throughout the Navin backend.
 * All errors thrown by services and controllers should use this class.
 *
 * @class AppError
 * @extends Error
 *
 * @property {number} statusCode - HTTP status code (200-599)
 * @property {string} code - Error code from ErrorCodes registry.
 *   Always matches one of the values in ErrorCodes.
 *   Clients use this to implement programmatic error handling.
 *   See docs/ERROR_CODES.md for complete error code documentation.
 *
 * @example
 * // Throw validation error (400)
 * throw new AppError(400, 'Email is required', ErrorCodes.VALIDATION_ERROR);
 *
 * // Throw not found error (404)
 * throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
 *
 * // Throw permission error (403)
 * throw new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN);
 */
export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
