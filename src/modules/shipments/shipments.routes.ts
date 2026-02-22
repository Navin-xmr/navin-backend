import { Router } from 'express';
import { getShipments, createShipment, patchShipment } from './shipments.controller';
import { requireRole } from '../../shared/middleware/requireRole';

const router = Router();

router.get('/', getShipments);
router.post('/', requireRole(['MANAGER', 'ADMIN']), createShipment);
router.patch('/:id', patchShipment);

export default router;
