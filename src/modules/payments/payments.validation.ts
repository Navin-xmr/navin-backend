import { z } from 'zod';
import { PaymentStatus } from './payments.model.js';

const TokenEnum = z.enum(['XLMN', 'USDC', 'Other']);

/**
 * Body schema for `POST /api/payments` (same router as `/api/settlements`).
 *
 * Business domain: create a settlement/payment tied to a shipment on Stellar-backed rails.
 * `token` is the canonical asset field; `tokenType` remains accepted so older clients
 * do not break during the rename. Amount must be positive because zero/negative
 * settlements are not meaningful escrow events.
 */
export const CreatePaymentBodySchema = z
  .object({
    shipmentId: z.string().min(1),
    amount: z.number().positive('Amount must be positive'),
    /** Preferred field name going forward. */
    token: TokenEnum.optional(),
    /** @deprecated Alias for token — accepted for backward compatibility. */
    tokenType: TokenEnum.optional(),
    payerAddress: z.string().optional(),
    payeeAddress: z.string().optional(),
    status: z.nativeEnum(PaymentStatus).optional().default(PaymentStatus.PENDING),
  })
  .transform(data => ({
    ...data,
    // Coalesce: prefer explicit `token`, fall back to `tokenType`
    token: (data.token ?? data.tokenType) as 'XLMN' | 'USDC' | 'Other',
  }))
  // Settlements must declare which on-chain asset they settle in; without token/tokenType
  // downstream Stellar posting and explorer URL generation cannot proceed safely.
  .superRefine((data, ctx) => {
    if (!data.token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either token or tokenType is required',
        path: ['token'],
      });
    }
  });

/**
 * Body schema for `PATCH /api/payments/:id/status`.
 *
 * Business domain: advance settlement lifecycle (e.g. Pending → Escrowed → Released).
 * Optional stellarTxHash links the status change to an on-chain transaction for audit.
 */
export const UpdatePaymentStatusBodySchema = z.object({
  status: z.nativeEnum(PaymentStatus),
  stellarTxHash: z.string().optional(),
});

/**
 * Path-param schema for payment/settlement detail and status routes
 * (`GET /api/payments/:id`, `PATCH /api/payments/:id/status`, dispute routes).
 */
export const PaymentIdParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Query schema for `GET /api/payments` and `GET /api/settlements`.
 *
 * Business domain: cursor-paginated settlement history for an organization.
 * Optional status/organizationId filters support finance dashboards without
 * forcing full-table scans into the client.
 */
export const GetPaymentsQuerySchema = z.object({
  // Filtering
  status: z.nativeEnum(PaymentStatus).optional(),
  organizationId: z.string().optional(),
  shipmentId: z.string().optional(),

  // Sorting
  sortBy: z.enum(['amount', 'status', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  // Pagination mode 1: cursor-based
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),

  // Pagination mode 2: offset-based
  page: z.coerce.number().min(1).optional(),
});

/**
 * Body schema for `POST /api/settlements/:id/dispute` (and payments alias path).
 *
 * Business domain: mark a settlement Disputed with a required reason so escrow
 * review and analytics always have an attributable cause; notes are optional context.
 */
export const DisputeSettlementBodySchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  notes: z.string().optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentBodySchema>;
export type UpdatePaymentStatusInput = z.infer<typeof UpdatePaymentStatusBodySchema>;
export type GetPaymentsQuery = z.infer<typeof GetPaymentsQuerySchema>;
export type DisputeSettlementInput = z.infer<typeof DisputeSettlementBodySchema>;
