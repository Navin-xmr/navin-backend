import { ShipmentStatus } from './shipments.model.js';
import { Request, Response } from 'express';
import {
  getShipmentsService,
  getShipmentByIdService,
  getShipmentTimelineService,
  createShipmentService,
  patchShipmentService,
  updateShipmentStatusService,
  bulkUpdateShipmentStatusService,
  uploadShipmentProofService,
  createDisputeService,
  deleteShipmentService,
  getShipmentEtaService,
  exportShipmentsService,
  shipmentsToCSV,
  uploadShipmentDocumentService,
  uploadShipmentPhotoService,
  DOCUMENT_UPLOAD_CONSTRAINTS,
  PHOTO_UPLOAD_CONSTRAINTS,
} from './shipments.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type {
  GetShipmentsQuery,
  ExportShipmentsQuery,
  ShipmentTimelineQuery,
  ShipmentProofBody,
  UploadDocumentBody,
  UploadPhotoBody,
  CreateDisputeBody,
  CreateShipmentInput,
  ShipmentIdParam,
  ShipmentPatchBody,
  ShipmentStatusInput,
  BulkStatusUpdateInput,
} from './shipments.validation.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

/**
 * Lists shipments for the caller's organization with filters and offset pagination.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.query.status - Optional comma-separated status filter.
 * @param req.query.priority - Optional comma-separated priority filter (`URGENT`/`STANDARD`/`ECONOMY`).
 * @param req.query.page - Page number (default 1).
 * @param req.query.limit - Page size (default 20, max 100).
 * @param req.query.origin - Optional origin substring filter.
 * @param req.query.destination - Optional destination substring filter.
 * @param req.query.trackingNumber - Optional tracking number filter.
 * @param req.query.q - Optional full-text search.
 * @param req.query.from - Optional createdAt lower bound.
 * @param req.query.to - Optional createdAt upper bound.
 * @param req.query.sortBy - Optional sort field (`createdAt`/`priority`/`expectedDelivery`).
 * @param req.query.sortOrder - Sort direction (`asc`/`desc`, default `desc`).
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`page`, `limit`, `total`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks an allowed role.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getShipments = async (req: Request, res: Response) => {
  const query = req.query as unknown as GetShipmentsQuery;
  const {
    status,
    priority,
    page = 1,
    limit = 20,
    origin,
    destination,
    trackingNumber,
    q,
    from,
    to,
    sortBy,
    sortOrder,
  } = query;
  // Build explicit filters object to avoid unvalidated query parameters
  const filters: Record<string, unknown> = {};
  if (req.user?.organizationId) {
    filters.organizationId = req.user.organizationId;
  }
  const {
    data,
    page: currentPage,
    limit: currentLimit,
    total,
  } = await getShipmentsService({
    status,
    page: Number(page),
    limit: Number(limit),
    origin,
    destination,
    trackingNumber,
    q,
    from,
    to,
    priority,
    sortBy,
    sortOrder,
    filters,
  });

  sendResponse(res, 200, true, 'Shipments retrieved', data, {
    page: currentPage,
    limit: currentLimit,
    total,
  });
};

/**
 * Retrieves a shipment by id with org-scoped authorization (SUPER_ADMIN bypasses org check).
 * Requires auth and SUPER_ADMIN / ADMIN / MANAGER / VIEWER.
 *
 * @param req.params.id - Shipment id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the shipment.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role or shipment access is insufficient.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getShipmentById = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const shipment = await getShipmentByIdService(id, {
    organizationId: req.user?.organizationId,
    role: req.user?.role,
  });
  sendResponse(res, 200, true, 'Shipment retrieved', shipment);
};

/**
 * Returns a cursor-paginated activity timeline for a shipment.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.params.id - Shipment id.
 * @param req.query.cursor - Optional timeline cursor.
 * @param req.query.limit - Page size (default 20, max 100).
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`nextCursor`, `hasMore`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role or shipment access is insufficient.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/query validation fails.
 */
export const getShipmentTimeline = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const query = req.query as unknown as ShipmentTimelineQuery;
  const { cursor, limit = 20 } = query;
  const { data, nextCursor, hasMore } = await getShipmentTimelineService(id, {
    cursor,
    limit: Number(limit),
    organizationId: req.user?.organizationId,
    role: req.user?.role,
  });
  sendResponse(res, 200, true, 'Shipment timeline retrieved', data, { nextCursor, hasMore });
};

/**
 * Creates a new shipment. Requires auth and MANAGER / ADMIN.
 *
 * @param req.body.trackingNumber - Optional carrier tracking number.
 * @param req.body.origin - Origin location.
 * @param req.body.destination - Destination location.
 * @param req.body.enterpriseId - Enterprise party id.
 * @param req.body.logisticsId - Logistics party id.
 * @param req.body.offChainMetadata - Optional off-chain metadata map.
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the created shipment.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks MANAGER / ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 */
export const createShipment = async (req: Request, res: Response) => {
  const body = req.body as CreateShipmentInput;
  const shipment = await createShipmentService({ ...body, actorUserId: req.user?.userId });
  sendResponse(res, 201, true, 'Shipment created', shipment);
};

/**
 * Patches a shipment's off-chain metadata. Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @param req.body.offChainMetadata - Optional metadata map to apply.
 * @returns HTTP 200 with envelope on success; HTTP 404 envelope `{ success: false }` when not found.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const patchShipment = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const { offChainMetadata } = req.body as ShipmentPatchBody;
  const shipment = await patchShipmentService(id, offChainMetadata);
  if (!shipment) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }
  sendResponse(res, 200, true, 'Shipment updated', shipment);
};

/**
 * Updates a shipment's lifecycle status. Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @param req.body.status - Target `ShipmentStatus` value.
 * @returns HTTP 200 with envelope on success; HTTP 400/404 envelopes (non-AppError) for missing/invalid status or not found.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 ERR_SHIPMENT_INVALID_TRANSITION — when the status transition is not allowed.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const patchShipmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const { status } = req.body as ShipmentStatusInput;

  if (!status || typeof status !== 'string') {
    sendResponse(res, 400, false, 'Missing status', null);
    return;
  }

  if (!Object.values(ShipmentStatus).includes(status as ShipmentStatus)) {
    sendResponse(res, 400, false, 'Invalid status value', null);
    return;
  }

  const user = req.user;

  const updated = await updateShipmentStatusService(id, status as ShipmentStatus, {
    userId: user?.userId,
  });
  if (!updated) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }
  sendResponse(res, 200, true, 'Shipment status updated', updated);
};

/**
 * Updates multiple shipments' status in a single bulk request. Returns partial results —
 * one shipment failing never rolls back updates already applied to others.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.body.shipmentIds - Shipment ids to update (1–50).
 * @param req.body.status - Target `ShipmentStatus` applied to each shipment.
 * @returns HTTP 200 with envelope `{ success, message, data }` where data is
 *   `{ updated, failed: Array<{ id, reason }> }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 */
export const bulkUpdateShipmentStatus = async (req: Request, res: Response) => {
  const { shipmentIds, status } = req.body as BulkStatusUpdateInput;
  const user = req.user;

  const result = await bulkUpdateShipmentStatusService(
    { shipmentIds, status },
    user?.organizationId ?? '',
    { userId: user?.userId }
  );

  sendResponse(res, 200, true, 'Bulk status update completed', result);
};

/**
 * Uploads proof-of-delivery for a shipment (multipart `file`).
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @param req.body.recipientSignatureName - Optional recipient signature name.
 * @param req.body.notes - Optional proof notes.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the updated shipment (may be null if id missing).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when no file is uploaded.
 * @throws {AppError} 503 SERVICE_UNAVAILABLE — when storage upload fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const uploadShipmentProof = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const { recipientSignatureName, notes } = req.body as ShipmentProofBody;
  const file = req.file;

  if (!file) {
    throw new AppError(400, 'No file uploaded', ErrorCodes.BAD_REQUEST);
  }

  const shipment = await uploadShipmentProofService(id, file, {
    recipientSignatureName,
    notes,
    actorUserId: req.user?.userId,
  });

  sendResponse(res, 200, true, 'Proof uploaded', shipment);
};

/**
 * Uploads a classified trade document for a shipment (multipart `file`).
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @param req.body.type - Document classification enum.
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the uploaded document.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when no file is uploaded.
 * @throws {AppError} 415 ERR_INVALID_MIME_TYPE — when the MIME type is not allowed.
 * @throws {AppError} 413 ERR_FILE_TOO_LARGE — when the file exceeds the document size limit.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 503 SERVICE_UNAVAILABLE — when storage upload fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const uploadShipmentDocument = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const { type } = req.body as UploadDocumentBody;
  const file = req.file;

  if (!file) {
    throw new AppError(400, 'No file uploaded', ErrorCodes.BAD_REQUEST);
  }

  if (!DOCUMENT_UPLOAD_CONSTRAINTS.mimeTypes.includes(file.mimetype)) {
    throw new AppError(
      415,
      `Invalid MIME type. Allowed: ${DOCUMENT_UPLOAD_CONSTRAINTS.mimeTypes.join(', ')}`,
      ErrorCodes.INVALID_MIME_TYPE
    );
  }

  if (file.size > DOCUMENT_UPLOAD_CONSTRAINTS.maxSize) {
    throw new AppError(
      413,
      `File too large. Maximum size is ${DOCUMENT_UPLOAD_CONSTRAINTS.maxSize / (1024 * 1024)}MB`,
      ErrorCodes.FILE_TOO_LARGE
    );
  }

  const document = await uploadShipmentDocumentService(id, file, type, req.user?.userId);
  sendResponse(res, 201, true, 'Document uploaded', document);
};

/**
 * Uploads a photo for a shipment (multipart `file`).
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @param req.body.caption - Optional caption (max 500 chars).
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the uploaded photo.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when no file is uploaded.
 * @throws {AppError} 415 ERR_INVALID_MIME_TYPE — when the MIME type is not allowed.
 * @throws {AppError} 413 ERR_FILE_TOO_LARGE — when the file exceeds the photo size limit.
 * @throws {AppError} 400 ERR_PHOTO_LIMIT_EXCEEDED — when the shipment already has the max photos.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 503 SERVICE_UNAVAILABLE — when storage upload fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const uploadShipmentPhoto = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const { caption } = req.body as UploadPhotoBody;
  const file = req.file;

  if (!file) {
    throw new AppError(400, 'No file uploaded', ErrorCodes.BAD_REQUEST);
  }

  if (!PHOTO_UPLOAD_CONSTRAINTS.mimeTypes.includes(file.mimetype)) {
    throw new AppError(
      415,
      `Invalid MIME type. Allowed: ${PHOTO_UPLOAD_CONSTRAINTS.mimeTypes.join(', ')}`,
      ErrorCodes.INVALID_MIME_TYPE
    );
  }

  if (file.size > PHOTO_UPLOAD_CONSTRAINTS.maxSize) {
    throw new AppError(
      413,
      `File too large. Maximum size is ${PHOTO_UPLOAD_CONSTRAINTS.maxSize / (1024 * 1024)}MB`,
      ErrorCodes.FILE_TOO_LARGE
    );
  }

  const photo = await uploadShipmentPhotoService(id, file, caption, req.user?.userId);
  sendResponse(res, 201, true, 'Photo uploaded', photo);
};

/**
 * Creates a dispute against a shipment (optional multipart `evidence` file).
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @param req.body.type - Dispute type enum.
 * @param req.body.description - Dispute description.
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the created dispute.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 503 SERVICE_UNAVAILABLE — when evidence storage upload fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const createDispute = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const { type, description } = req.body as CreateDisputeBody;
  const file = req.file;

  const dispute = await createDisputeService(id, file, {
    type,
    description,
    actorUserId: req.user?.userId,
  });
  sendResponse(res, 201, true, 'Dispute created', dispute);
};

/**
 * Exports filtered shipments as a downloadable CSV or JSON attachment (not the JSON envelope).
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.query.format - `csv` or `json` (default `json`).
 * @param req.query.status - Optional status filter.
 * @param req.query.origin - Optional origin filter.
 * @param req.query.destination - Optional destination filter.
 * @param req.query.startDate - Optional createdAt lower bound (offset ISO datetime).
 * @param req.query.endDate - Optional createdAt upper bound (offset ISO datetime).
 * @returns HTTP 200 raw `text/csv` or `application/json` attachment body.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 EXPORT_TOO_LARGE — when the result set exceeds 10,000 records.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const exportShipments = async (req: Request, res: Response) => {
  const query = req.query as unknown as ExportShipmentsQuery;
  const { format = 'json', status, origin, destination, startDate, endDate } = query;
  const organizationId = req.user?.organizationId;

  const shipments = await exportShipmentsService({
    organizationId,
    status,
    origin,
    destination,
    startDate,
    endDate,
  });

  const dateStr = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="shipments-export-${dateStr}.csv"`);
    res.status(200).send(shipmentsToCSV(shipments));
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="shipments-export-${dateStr}.json"`);
  res.status(200).json(shipments);
};

/**
 * Soft-deletes a shipment. Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Shipment id.
 * @returns HTTP 200 with envelope on success; HTTP 404 envelope `{ success: false }` when not found.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const deleteShipment = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const shipment = await deleteShipmentService(id);

  if (!shipment) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }

  sendResponse(res, 200, true, 'Shipment deleted successfully', shipment);
};

/**
 * Computes ETA for an in-transit shipment from recent GPS telemetry.
 * Requires authentication.
 *
 * @param req.params.id - Shipment id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing ETA payload (or null ETA with reason when not in transit).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 400 ERR_SHIPMENT_ETA_DESTINATION_MISSING — when destination coordinates are missing.
 * @throws {AppError} 404 ERR_SHIPMENT_ETA_NO_GPS — when no GPS telemetry points exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getShipmentEta = async (req: Request, res: Response) => {
  const { id } = req.params as unknown as ShipmentIdParam;
  const eta = await getShipmentEtaService(id);
  sendResponse(res, 200, true, 'Shipment ETA retrieved', eta);
};
