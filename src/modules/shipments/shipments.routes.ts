import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { validateRequest } from '../../shared/validation/validate.js';
import {
  getShipments,
  getShipmentById,
  getShipmentTimeline,
  createShipment,
  patchShipment,
  patchShipmentStatus,
  bulkUpdateShipmentStatus,
  uploadShipmentProof,
  createDispute,
  deleteShipment,
  getShipmentEta,
  exportShipments,
  uploadShipmentDocument,
  uploadShipmentPhoto,
} from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import multer from 'multer';
import {
  getShipmentsQuerySchema,
  ExportShipmentsQuerySchema,
  CreateShipmentBodySchema,
  ShipmentIdParamSchema,
  ShipmentPatchBodySchema,
  ShipmentProofBodySchema,
  ShipmentStatusBodySchema,
  BulkStatusUpdateBodySchema,
  ShipmentTimelineQuerySchema,
  CreateDisputeBodySchema,
  UploadDocumentBodySchema,
  UploadPhotoBodySchema,
} from './shipments.validation.js';

import { UserRole } from '../../shared/constants/index.js';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Invalid MIME type', ErrorCodes.INVALID_MIME_TYPE));
    }
  },
});

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (PHOTO_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Invalid MIME type', ErrorCodes.INVALID_MIME_TYPE));
    }
  },
});

shipmentsRouter.get(
  '/export',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ query: ExportShipmentsQuerySchema }),
  asyncHandler(exportShipments)
);

shipmentsRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ query: getShipmentsQuerySchema }),
  asyncHandler(getShipments)
);

// Registered before the `/:id` routes below so the literal `/bulk/status` segment
// isn't swallowed by the `/:id/status` param route (Express matches in registration order).
shipmentsRouter.patch(
  '/bulk/status',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ body: BulkStatusUpdateBodySchema }),
  asyncHandler(bulkUpdateShipmentStatus)
);

shipmentsRouter.get(
  '/:id',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: ShipmentIdParamSchema }),
  asyncHandler(getShipmentById)
);
shipmentsRouter.post(
  '/',
  requireAuth,
  requireRole(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest({ body: CreateShipmentBodySchema }),
  asyncHandler(createShipment)
);
shipmentsRouter.patch(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: ShipmentIdParamSchema, body: ShipmentPatchBodySchema }),
  asyncHandler(patchShipment)
);
shipmentsRouter.patch(
  '/:id/status',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: ShipmentIdParamSchema, body: ShipmentStatusBodySchema }),
  asyncHandler(patchShipmentStatus)
);
shipmentsRouter.post(
  '/:id/proof',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  upload.single('file'),
  validateRequest({ params: ShipmentIdParamSchema, body: ShipmentProofBodySchema }),
  asyncHandler(uploadShipmentProof)
);
shipmentsRouter.post(
  '/:id/documents',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  documentUpload.single('file'),
  validateRequest({ params: ShipmentIdParamSchema, body: UploadDocumentBodySchema }),
  asyncHandler(uploadShipmentDocument)
);
shipmentsRouter.post(
  '/:id/photos',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  photoUpload.single('file'),
  validateRequest({ params: ShipmentIdParamSchema, body: UploadPhotoBodySchema }),
  asyncHandler(uploadShipmentPhoto)
);
shipmentsRouter.post(
  '/:id/disputes',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  upload.single('evidence'),
  validateRequest({ params: ShipmentIdParamSchema, body: CreateDisputeBodySchema }),
  asyncHandler(createDispute)
);
shipmentsRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: ShipmentIdParamSchema }),
  asyncHandler(deleteShipment)
);

shipmentsRouter.get(
  '/:id/eta',
  requireAuth,
  validateRequest({ params: ShipmentIdParamSchema }),
  asyncHandler(getShipmentEta)
);

shipmentsRouter.get(
  '/:id/timeline',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: ShipmentIdParamSchema, query: ShipmentTimelineQuerySchema }),
  asyncHandler(getShipmentTimeline)
);

export default shipmentsRouter;
