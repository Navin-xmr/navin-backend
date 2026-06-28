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
  INVALID_RESET_TOKEN: 'ERR_AUTH_INVALID_RESET_TOKEN',
  INVALID_TRANSITION: 'ERR_SHIPMENT_INVALID_TRANSITION',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
