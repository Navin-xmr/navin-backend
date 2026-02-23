import { Router } from 'express';
import { getShipments, createShipment, patchShipment, patchShipmentStatus } from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

export const shipmentsRouter = Router();

shipmentsRouter.get('/', getShipments);
shipmentsRouter.post('/', requireRole(...['MANAGER', 'ADMIN']), createShipment);
shipmentsRouter.patch('/:id', patchShipment);
shipmentsRouter.patch('/:id/status', requireAuth, patchShipmentStatus);

export default shipmentsRouter;
