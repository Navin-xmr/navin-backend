import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validate } from '../../shared/validation/validate.js';
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
import multer from 'multer';
import { ShipmentProofBodySchema } from './shipments.validation.js';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

shipmentsRouter.get('/', asyncHandler(getShipments));
shipmentsRouter.post(
  '/',
  requireAuth,
  requireRole(...['MANAGER', 'ADMIN']),
  asyncHandler(createShipment)
);
shipmentsRouter.patch('/:id', asyncHandler(patchShipment));
shipmentsRouter.patch('/:id/status', requireAuth, asyncHandler(patchShipmentStatus));
shipmentsRouter.post(
  '/:id/proof',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  upload.single('file'),
  validate({ body: ShipmentProofBodySchema }),
  asyncHandler(uploadShipmentProof)
);
shipmentsRouter.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(deleteShipment)
);

export default shipmentsRouter;
