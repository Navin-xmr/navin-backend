import { ShipmentStatus } from './shipments.model.js';
import { Request, Response } from 'express';
import {
  getShipmentsService,
  createShipmentService,
  patchShipmentService,
  updateShipmentStatusService,
  uploadShipmentProofService,
  deleteShipmentService,
} from './shipments.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

export const getShipments = async (req: Request, res: Response) => {
  const { status, cursor, limit = 20, ...filters } = req.query;
  const { data, nextCursor, hasMore } = await getShipmentsService({
    status,
    cursor,
    limit: Number(limit),
    filters: filters as Record<string, unknown>,
  });

  sendResponse(res, 200, true, 'Shipments retrieved', data, { nextCursor, hasMore });
};

export const createShipment = async (req: Request, res: Response) => {
  const shipment = await createShipmentService(req.body);
  sendResponse(res, 201, true, 'Shipment created', shipment);
};

export const patchShipment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { offChainMetadata } = req.body;
  const shipment = await patchShipmentService(id, offChainMetadata);
  if (!shipment) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }
  sendResponse(res, 200, true, 'Shipment updated', shipment);
};

export const patchShipmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || typeof status !== 'string') {
    sendResponse(res, 400, false, 'Missing status', null);
    return;
  }

  if (!Object.values(ShipmentStatus).includes(status as ShipmentStatus)) {
    sendResponse(res, 400, false, 'Invalid status value', null);
    return;
  }

  const user = req.user;

  try {
    const updated = await updateShipmentStatusService(id, status as ShipmentStatus, {
      userId: user?.userId,
    });
    if (!updated) {
      sendResponse(res, 404, false, 'Shipment not found', null);
      return;
    }
    sendResponse(res, 200, true, 'Shipment status updated', updated);
  } catch (err) {
    sendResponse(res, 400, false, (err as Error).message || 'Failed to update status', null);
  }
};

export const uploadShipmentProof = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { recipientSignatureName, notes } = req.body as {
    recipientSignatureName?: string;
    notes?: string;
  };
  const file = req.file;

  if (!file) {
    sendResponse(res, 400, false, 'No file uploaded', null);
    return;
  }

  const shipment = await uploadShipmentProofService(id, file, {
    recipientSignatureName,
    notes,
  });

  if (!shipment) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }

  sendResponse(res, 200, true, 'Proof uploaded', shipment);
};

export const deleteShipment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const shipment = await deleteShipmentService(id);

  if (!shipment) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }

  sendResponse(res, 200, true, 'Shipment deleted successfully', shipment);
};
