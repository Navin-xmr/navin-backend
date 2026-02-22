import { Router } from 'express';
import { getShipments, createShipment, patchShipment } from './shipments.controller.js';
import { requireRole } from '../../shared/middleware/requireRole.js';

export const shipmentsRouter = Router();

shipmentsRouter.get('/', getShipments);
shipmentsRouter.post('/', requireRole(...['MANAGER', 'ADMIN']), createShipment);
shipmentsRouter.patch('/:id', patchShipment);

export default shipmentsRouter;
