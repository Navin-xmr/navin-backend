import { Shipment, ShipmentStatus } from './shipments.model.js';
import type { FilterQuery } from 'mongoose';
import { tokenizeShipment } from '../../services/stellar.service.js';
import { mockUploadToStorage } from '../../services/mockStorageService.js';
import { UserModel } from '../users/users.model.js';
import { emitStatusUpdate } from '../../infra/socket/io.js';

type ShipmentListResult = {
  data: Awaited<ReturnType<typeof findShipments>>;
  nextCursor: string | null;
  hasMore: boolean;
};

export const findShipments = async (query: FilterQuery<unknown>, limit: number) => {
  return Shipment.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
};

export const getShipmentsService = async (params: {
  status?: unknown;
  cursor?: unknown;
  limit: number;
  filters: Record<string, unknown>;
}): Promise<ShipmentListResult> => {
  const { status, cursor, limit, filters } = params;
  const query: FilterQuery<unknown> = { ...filters };

  if (status) query.status = status;
  if (cursor) query._id = { $lt: cursor };

  const shipments = await findShipments(query, limit);
  const hasMore = shipments.length > limit;
  const data = hasMore ? shipments.slice(0, limit) : shipments;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]._id.toString() : null;

  return { data, nextCursor, hasMore };
};

export const createShipmentService = async (data: {
  trackingNumber: string;
  origin: string;
  destination: string;
  [key: string]: unknown;
}) => {
  const shipment = new Shipment(data);
  await shipment.save();

  try {
    const stellar = await tokenizeShipment({
      trackingNumber: shipment.trackingNumber,
      origin: shipment.origin,
      destination: shipment.destination,
      shipmentId: shipment._id.toString(),
    });
    shipment.stellarTokenId = stellar.stellarTokenId;
    shipment.stellarTxHash = stellar.stellarTxHash;
    await shipment.save();
  } catch (err) {
    console.warn('Stellar tokenization skipped:', (err as Error).message);
  }

  return shipment;
};

export const patchShipmentService = async (id: string, offChainMetadata: unknown) => {
  return Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
};

export const updateShipmentStatusService = async (
  id: string,
  status: ShipmentStatus,
  actor?: { userId?: string; walletAddress?: string }
) => {
  const shipment = await Shipment.findById(id);
  if (!shipment) return null;

  if (shipment.status === status) return shipment;

  if (!Object.values(ShipmentStatus).includes(status)) {
    throw new Error('Invalid status');
  }

  shipment.status = status;

  const milestone: Record<string, unknown> = {
    name: status,
    timestamp: new Date(),
    description: `Status changed to ${status}`,
  };

  if (actor?.userId) {
    milestone.userId = actor.userId;
    const found = await UserModel.findById(actor.userId)
      .select({ walletAddress: 1 })
      .lean<{ walletAddress?: string }>();
    if (found?.walletAddress) {
      milestone.walletAddress = found.walletAddress;
    }
  }

  shipment.milestones.push(milestone);

  await shipment.save();

  emitStatusUpdate(id, {
    shipmentId: id,
    status: shipment.status,
    milestones: shipment.milestones,
    updatedAt: shipment.updatedAt,
  });

  return shipment;
};

export const uploadShipmentProofService = async (
  id: string,
  file: Express.Multer.File,
  recipientSignatureName: string
) => {
  const fakeUrl = await mockUploadToStorage(file);
  const shipment = await Shipment.findByIdAndUpdate(
    id,
    {
      deliveryProof: {
        url: fakeUrl,
        recipientSignatureName,
        uploadedAt: new Date(),
      },
    },
    { new: true }
  );
  return shipment;
};
