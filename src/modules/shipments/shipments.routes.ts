import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import {
  getShipments,
  createShipment,
  patchShipment,
  patchShipmentStatus,
  uploadShipmentProof,
  deleteShipment,
} from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validateRequest } from '../../shared/validation/validate.js';
import multer from 'multer';
import {
  CreateShipmentBodySchema,
  ShipmentIdParamSchema,
  ShipmentPatchBodySchema,
  ShipmentProofBodySchema,
  ShipmentsQuerySchema,
  ShipmentStatusBodySchema,
} from './shipments.validation.js';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

shipmentsRouter.get(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'VIEWER', 'CUSTOMER'),
  validateRequest({ query: ShipmentsQuerySchema }),
  asyncHandler(getShipments)
);
shipmentsRouter.post(
  '/',
  requireAuth,
  requireRole(...['MANAGER', 'ADMIN']),
  validateRequest({ body: CreateShipmentBodySchema }),
  asyncHandler(createShipment)
);
shipmentsRouter.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  validateRequest({ params: ShipmentIdParamSchema, body: ShipmentPatchBodySchema }),
  asyncHandler(patchShipment)
);
shipmentsRouter.patch(
  '/:id/status',
  requireAuth,
  validateRequest({ params: ShipmentIdParamSchema, body: ShipmentStatusBodySchema }),
  asyncHandler(patchShipmentStatus)
);
shipmentsRouter.post(
  '/:id/proof',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  upload.single('file'),
  validateRequest({ params: ShipmentIdParamSchema, body: ShipmentProofBodySchema }),
  asyncHandler(uploadShipmentProof)
);
shipmentsRouter.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  validateRequest({ params: ShipmentIdParamSchema }),
  asyncHandler(deleteShipment)
);

export default shipmentsRouter;
