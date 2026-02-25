import { Router } from 'express';
import { getShipments, createShipment, patchShipment, patchShipmentStatus, uploadShipmentProof } from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

export const shipmentsRouter = Router();

shipmentsRouter.get('/', getShipments);
shipmentsRouter.post('/', requireRole(...['MANAGER', 'ADMIN']), createShipment);
shipmentsRouter.patch('/:id', patchShipment);
shipmentsRouter.patch('/:id/status', requireAuth, patchShipmentStatus);
shipmentsRouter.post('/:id/proof', uploadShipmentProof);

export default shipmentsRouter;
