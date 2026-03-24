import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { getShipments, createShipment, patchShipment, patchShipmentStatus, uploadShipmentProof } from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import multer from 'multer';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

shipmentsRouter.get('/', asyncHandler(getShipments));
shipmentsRouter.post('/', requireAuth, requireRole(...['MANAGER', 'ADMIN']), asyncHandler(createShipment));
shipmentsRouter.patch('/:id', asyncHandler(patchShipment));
shipmentsRouter.patch('/:id/status', requireAuth, asyncHandler(patchShipmentStatus));
shipmentsRouter.post('/:id/proof', upload.single('file'), asyncHandler(uploadShipmentProof));

export default shipmentsRouter;
