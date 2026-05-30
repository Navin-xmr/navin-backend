import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
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
import { validate } from '../../shared/validation/validate.js';
import { getShipmentsQuerySchema } from './shipments.validation.js';
import multer from 'multer';
import {
  CreateShipmentBodySchema,
  ShipmentIdParamSchema,
  ShipmentPatchBodySchema,
  ShipmentProofBodySchema,
  ShipmentStatusBodySchema,
} from './shipments.validation.js';

import { UserRole } from '../../shared/constants/index.js';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

shipmentsRouter.get('/', requireAuth, requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER), validate({ query: getShipmentsQuerySchema }), asyncHandler(getShipments));
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

export default shipmentsRouter;
