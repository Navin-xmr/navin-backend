import { Router } from 'express';
import { getShipments, createShipment, patchShipment, patchShipmentStatus, uploadShipmentProof } from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import multer from 'multer';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

shipmentsRouter.get('/', getShipments);
shipmentsRouter.post('/', requireRole(...['MANAGER', 'ADMIN']), createShipment);
shipmentsRouter.patch('/:id', patchShipment);
shipmentsRouter.patch('/:id/status', requireAuth, patchShipmentStatus);
shipmentsRouter.post('/:id/proof', upload.single('file'), uploadShipmentProof);

export default shipmentsRouter;
