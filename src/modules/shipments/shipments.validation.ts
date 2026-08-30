import { z } from 'zod';
import { ShipmentStatus } from './shipments.model.js';

const statusFilterSchema = z
  .string()
  .optional()
  .transform(value => {
    if (!value || value.trim() === '') return undefined;
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  })
  .pipe(z.array(z.nativeEnum(ShipmentStatus)).min(1).optional());

const priorityFilterSchema = z
  .string()
  .optional()
  .transform(value => {
    if (!value || value.trim() === '') return undefined;
    return value
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  })
  .pipe(
    z
      .array(z.enum(['URGENT', 'STANDARD', 'ECONOMY']))
      .min(1)
      .optional()
  );

const optionalNonEmptyString = z
  .string()
  .optional()
  .transform(value => {
    if (value == null || value.trim() === '') return undefined;
    return value.trim();
  });

/**
 * Query schema for `GET /api/shipments` (also exported as `ShipmentsQuerySchema`).
 *
 * Business domain: admin/dashboard shipment listing with offset pagination.
 * Unlike telemetry (cursor-first for large IoT streams), shipments use page/limit
 * because the UI expects stable page numbers and a total count for table controls.
 *
 * Filters (status, priority, origin, destination, dates, sort) exist so operators
 * can narrow active freight without downloading the full org catalog.
 */
export const getShipmentsQuerySchema = z
  .object({
    status: statusFilterSchema,
    priority: priorityFilterSchema,
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    origin: optionalNonEmptyString,
    destination: optionalNonEmptyString,
    trackingNumber: optionalNonEmptyString,
    q: optionalNonEmptyString,
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: z.enum(['createdAt', 'priority', 'expectedDelivery']).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()
  // createdAt / delivery windows are used for ops reporting; inverted ranges
  // would silently return empty lists and look like a permissions bug.
  .refine(data => !(data.from && data.to && data.from > data.to), {
    message: 'from must be <= to',
    path: ['from'],
  });

export type GetShipmentsQuery = z.infer<typeof getShipmentsQuerySchema>;

/**
 * Body schema for `POST /api/shipments/bulk/status`.
 *
 * Business domain: batch status transitions for dispatch workflows.
 * Caps at 50 IDs so a single request cannot lock or overwhelm status-transition
 * side effects (timeline events, notifications, settlement hooks).
 */
export const BulkStatusUpdateBodySchema = z.object({
  shipmentIds: z.array(z.string().min(1)).min(1).max(50),
  status: z.nativeEnum(ShipmentStatus),
});

export type BulkStatusUpdateInput = z.infer<typeof BulkStatusUpdateBodySchema>;

/**
 * Body schema for `POST /api/shipments`.
 *
 * Business domain: create a shipment and (via service) tokenize it on Stellar.
 * enterpriseId / logisticsId identify the two parties on the trade lane;
 * optional trackingNumber lets clients supply carrier IDs when already known.
 */
export const CreateShipmentBodySchema = z.object({
  trackingNumber: z.string().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  enterpriseId: z.string().min(1),
  logisticsId: z.string().min(1),
  offChainMetadata: z.record(z.unknown()).optional(),
});

export type CreateShipmentInput = z.infer<typeof CreateShipmentBodySchema>;

/**
 * Path-param schema for shipment-scoped routes (`GET/PATCH/DELETE /api/shipments/:id`, etc.).
 *
 * Business domain: identify a single shipment resource. Empty IDs are rejected
 * early so handlers never query Mongo with a blank key.
 */
export const ShipmentIdParamSchema = z.object({
  id: z.string().min(1),
});

export type ShipmentIdParam = z.infer<typeof ShipmentIdParamSchema>;

/**
 * Body schema for `PATCH /api/shipments/:id`.
 *
 * Business domain: update off-chain (non-Stellar) metadata only — on-chain
 * identity and status transitions use dedicated endpoints to keep audit trails clear.
 */
export const ShipmentPatchBodySchema = z.object({
  offChainMetadata: z.record(z.unknown()).optional(),
});

export type ShipmentPatchBody = z.infer<typeof ShipmentPatchBodySchema>;

/**
 * Body schema for `PATCH /api/shipments/:id/status`.
 *
 * Business domain: explicit lifecycle transition. Optional milestoneData carries
 * event payload for timeline/audit without changing the status enum itself.
 */
export const ShipmentStatusBodySchema = z.object({
  status: z.nativeEnum(ShipmentStatus),
  milestoneData: z.record(z.unknown()).optional(),
});

export type ShipmentStatusInput = z.infer<typeof ShipmentStatusBodySchema>;

/**
 * Body schema for `POST /api/shipments/:id/proof` (multipart fields alongside the file).
 *
 * Business domain: proof-of-delivery metadata. Signature name and notes are optional
 * because some carriers upload photo/signature files without typed recipient fields.
 */
export const ShipmentProofBodySchema = z.object({
  recipientSignatureName: z.string().optional(),
  notes: z.string().optional(),
});

export type ShipmentProofBody = z.infer<typeof ShipmentProofBodySchema>;

/**
 * Body schema for `POST /api/shipments/:id/disputes`.
 *
 * Business domain: formalize a cargo/payment disagreement with a constrained type
 * enum so analytics and settlement dispute flows can categorize consistently.
 */
export const CreateDisputeBodySchema = z.object({
  type: z.enum(['WRONG_GOODS', 'DAMAGED', 'NOT_DELIVERED', 'PAYMENT_DISAGREEMENT', 'OTHER']),
  description: z.string().min(1),
});

export type CreateDisputeBody = z.infer<typeof CreateDisputeBodySchema>;

/**
 * Query schema for `GET /api/shipments/:id/timeline`.
 *
 * Business domain: unified activity feed (status changes, telemetry events, docs).
 * Cursor pagination is used because timelines grow unboundedly with shipment lifetime.
 */
export const ShipmentTimelineQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ShipmentTimelineQuery = z.infer<typeof ShipmentTimelineQuerySchema>;

/** Alias of `getShipmentsQuerySchema` for callers that prefer the Shipments* naming. */
export const ShipmentsQuerySchema = getShipmentsQuerySchema;

/**
 * Body schema for `POST /api/shipments/:id/documents` (document type field with upload).
 *
 * Business domain: classify trade documents so compliance and customs tooling
 * can filter by document kind rather than free-text filenames.
 */
export const UploadDocumentBodySchema = z.object({
  type: z.enum([
    'BILL_OF_LADING',
    'CUSTOMS_DECLARATION',
    'INSURANCE_CERTIFICATE',
    'PACKING_LIST',
    'INVOICE',
    'OTHER',
  ]),
});

export type UploadDocumentBody = z.infer<typeof UploadDocumentBodySchema>;

/**
 * Body schema for `POST /api/shipments/:id/photos`.
 *
 * Business domain: optional human-readable caption for warehouse/delivery photos.
 * Caption length is capped to keep list UIs readable and storage metadata small.
 */
export const UploadPhotoBodySchema = z.object({
  caption: z.string().max(500).optional(),
});

export type UploadPhotoBody = z.infer<typeof UploadPhotoBodySchema>;

/**
 * Query schema for `GET /api/shipments/export`.
 *
 * Business domain: download filtered shipment sets for offline reporting.
 * Format defaults to JSON for API clients; CSV supports spreadsheet workflows.
 * Date filters use offset-aware ISO strings so export windows are timezone-unambiguous.
 */
export const ExportShipmentsQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  status: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

export type ExportShipmentsQuery = z.infer<typeof ExportShipmentsQuerySchema>;
