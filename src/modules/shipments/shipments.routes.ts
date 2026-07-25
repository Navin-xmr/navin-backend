import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import {
  getShipments,
  getShipmentById,
  getShipmentTimeline,
  createShipment,
  patchShipment,
  patchShipmentStatus,
  uploadShipmentProof,
  deleteShipment,
  getShipmentEta,
  exportShipments,
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
  ShipmentTimelineQuerySchema,
} from './shipments.validation.js';

import { UserRole } from '../../shared/constants/index.js';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

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
