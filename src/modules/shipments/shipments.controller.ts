import { ShipmentStatus } from './shipments.model.js';
import { Request, Response } from 'express';
import {
  getShipmentsService,
  createShipmentService,
  patchShipmentService,
  updateShipmentStatusService,
  uploadShipmentProofService,
  deleteShipmentService,
  getShipmentEtaService,
  exportShipmentsService,
  shipmentsToCSV,
} from './shipments.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type { GetShipmentsQuery, ExportShipmentsQuery } from './shipments.validation.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

export const getShipments = async (req: Request, res: Response) => {
  const query = req.query as unknown as GetShipmentsQuery;
  const { status, page = 1, limit = 20, origin, destination } = query;
  // Build explicit filters object to avoid unvalidated query parameters
  const filters: Record<string, unknown> = {};
  if (req.user?.organizationId) {
    filters.organizationId = req.user.organizationId;
  }
  const {
    data,
    page: currentPage,
    limit: currentLimit,
    total,
  } = await getShipmentsService({
    status,
    page: Number(page),
    limit: Number(limit),
    origin,
    destination,
    filters,
  });

  sendResponse(res, 200, true, 'Shipments retrieved', data, {
    page: currentPage,
    limit: currentLimit,
    total,
  });
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

  const updated = await updateShipmentStatusService(id, status as ShipmentStatus, {
    userId: user?.userId,
  });
  if (!updated) {
    sendResponse(res, 404, false, 'Shipment not found', null);
    return;
  }
  sendResponse(res, 200, true, 'Shipment status updated', updated);
};

export const uploadShipmentProof = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { recipientSignatureName, notes } = req.body as {
    recipientSignatureName?: string;
    notes?: string;
  };
  const file = req.file;

  if (!file) {
    throw new AppError(400, 'No file uploaded', ErrorCodes.BAD_REQUEST);
  }

  const shipment = await uploadShipmentProofService(id, file, {
    recipientSignatureName,
    notes,
  });

  sendResponse(res, 200, true, 'Proof uploaded', shipment);
};

export const exportShipments = async (req: Request, res: Response) => {
  const query = req.query as unknown as ExportShipmentsQuery;
  const { format = 'json', status, origin, destination, startDate, endDate } = query;
  const organizationId = req.user?.organizationId;

  const shipments = await exportShipmentsService({
    organizationId,
    status,
    origin,
    destination,
    startDate,
    endDate,
  });

  const dateStr = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="shipments-export-${dateStr}.csv"`
    );
    res.status(200).send(shipmentsToCSV(shipments));
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="shipments-export-${dateStr}.json"`
  );
  res.status(200).json(shipments);
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

export const getShipmentEta = async (req: Request, res: Response) => {
  const { id } = req.params;
  const eta = await getShipmentEtaService(id);
  sendResponse(res, 200, true, 'Shipment ETA retrieved', eta);
};
