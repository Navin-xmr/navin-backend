import { ShipmentStatus } from './shipments.model.js';
import { Request, Response } from 'express';
import { UserModel } from '../users/users.model.js';
import type { FilterQuery } from 'mongoose';
import {
  findShipments,
  createShipmentService,
  patchShipmentService,
  updateShipmentStatusService,
  uploadShipmentProofService,
} from './shipments.service.js';
import { emitStatusUpdate } from '../../infra/socket/io.js';

export const getShipments = async (req: Request, res: Response) => {
  const { status, cursor, limit = 20, ...filters } = req.query;
  const query: FilterQuery<unknown> = { ...filters };
  if (status) query.status = status;
  if (cursor) query._id = { $lt: cursor };

  const shipments = await findShipments(query, Number(limit));
  const hasMore = shipments.length > Number(limit);
  const data = hasMore ? shipments.slice(0, Number(limit)) : shipments;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]._id.toString() : null;

  res.json({ data, nextCursor, hasMore });
};

export const createShipment = async (req: Request, res: Response) => {
  const shipment = await createShipmentService(req.body);
  res.status(201).json(shipment);
};

export const patchShipment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { offChainMetadata } = req.body;
  const shipment = await patchShipmentService(id, offChainMetadata);
  if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
  res.json(shipment);
};

export const patchShipmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || typeof status !== 'string') return res.status(400).json({ message: 'Missing status' });

  if (!Object.values(ShipmentStatus).includes(status as ShipmentStatus)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  const user = req.user;
  let walletAddress: string | undefined;
  if (user?.userId) {
    const found = await UserModel.findById(user.userId);
    walletAddress = found?.walletAddress || undefined;
  }

  try {
    const updated = await updateShipmentStatusService(id, status as ShipmentStatus, { userId: user?.userId, walletAddress });
    if (!updated) return res.status(404).json({ message: 'Shipment not found' });
    
    // Emit status update to the shipment room
    emitStatusUpdate(id, {
      shipmentId: id,
      status: updated.status,
      milestones: updated.milestones,
      updatedAt: updated.updatedAt,
    });
    
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message || 'Failed to update status' });
  }
};

export const uploadShipmentProof = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { recipientSignatureName } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const shipment = await uploadShipmentProofService(id, file, recipientSignatureName);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    return res.status(200).json({ shipment });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error });
  }
};
