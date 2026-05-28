import { Shipment } from './shipments.model.js';
import type { FilterQuery } from 'mongoose';
import { tokenizeShipment } from '../../services/stellar.service.js';
import { mockUploadToStorage } from '../../services/mockStorageService.js';
import { UserModel } from '../users/users.model.js';
import { emitStatusUpdate } from '../../infra/socket/io.js';
import { Anomaly } from '../anomaly/anomaly.model.js';
import { Telemetry } from '../telemetry/telemetry.model.js';
import { AppError } from '../../shared/http/errors.js';
import { IShipment, ShipmentStatus } from '../../shared/types/shipment.js';
import { auditLog } from '../../shared/utils/auditLog.js';
import { invalidateAnalyticsPerformanceCache } from '../analytics/analytics.cache.js';

type ShipmentListResult = {
  data: IShipment[];
  page: number;
  limit: number;
  total: number;
};

export const findShipments = async (
  query: FilterQuery<unknown>,
  skip: number,
  limit: number
): Promise<IShipment[]> => {
  return Shipment.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

export const getShipmentsService = async (params: {
  status?: string;
  page: number;
  limit: number;
  origin?: string;
  destination?: string;
  filters: Record<string, unknown>;
}): Promise<ShipmentListResult> => {
  const { status, page, limit, origin, destination, filters } = params;
  const query: FilterQuery<unknown> = { ...filters };

  if (status) query.status = status;
  if (origin) {
    const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.origin = { $regex: escapedOrigin, $options: 'i' };
  }
  if (destination) {
    const escapedDestination = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.destination = { $regex: escapedDestination, $options: 'i' };
  }

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    findShipments(query, skip, limit),
    Shipment.countDocuments(query),
  ]);

  return { data, page, limit, total };
};

export const createShipmentService = async (data: {
  trackingNumber?: string;
  origin: string;
  destination: string;
  [key: string]: unknown;
}) => {
  const trackingNumber =
    data.trackingNumber || `NVN-${Math.floor(100000 + Math.random() * 900000)}`;
  const shipment = new Shipment({ ...data, trackingNumber });
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

  const previousStatus = shipment.status;
  shipment.status = status;

  const milestone = {
    name: status,
    timestamp: new Date(),
    description: `Status changed to ${status}`,
  } as {
    name: string;
    timestamp: Date;
    description?: string;
    userId?: string;
    walletAddress?: string;
  };

  if (actor?.userId) {
    milestone.userId = actor.userId;
    const userLookup = UserModel.findById(actor.userId) as
      | {
          select?: (projection: { walletAddress: 1 }) => {
            lean: <T>() => Promise<T | null>;
          };
        }
      | Promise<{ walletAddress?: string } | null>
      | null;

    if (userLookup && typeof userLookup === 'object' && 'select' in userLookup) {
      const found = await userLookup
        .select?.({ walletAddress: 1 })
        .lean<{ walletAddress?: string }>();
      if (found?.walletAddress) {
        milestone.walletAddress = found.walletAddress;
      }
    } else {
      const found = await (userLookup as Promise<{ walletAddress?: string } | null>);
      if (found?.walletAddress) {
        milestone.walletAddress = found.walletAddress;
      }
    }
  }

  shipment.milestones.push(milestone);

  await shipment.save();
  await invalidateAnalyticsPerformanceCache();

  if (actor?.userId) {
    auditLog({
      userId: actor.userId,
      action: 'SHIPMENT_STATUS_CHANGED',
      resourceId: id,
      timestamp: new Date(),
      metadata: { previousStatus, newStatus: status },
    });
  }

  emitStatusUpdate(id, {
    shipmentId: id,
    status: shipment.status,
    milestones: shipment.milestones.map(m => ({
      name: m.name,
      timestamp: m.timestamp,
      description: m.description ?? undefined,
      userId: m.userId?.toString() ?? undefined,
      walletAddress: m.walletAddress ?? undefined,
    })),
    updatedAt: shipment.updatedAt,
  });

  return shipment;
};

export const uploadShipmentProofService = async (
  id: string,
  file: Express.Multer.File,
  proof: { recipientSignatureName?: string; notes?: string }
) => {
  let proofUrl: string;

  try {
    proofUrl = await mockUploadToStorage(file);
  } catch (error) {
    throw new AppError(503, 'Storage bucket unavailable, please try again later.', 'SERVICE_UNAVAILABLE');
  }

  const shipment = await Shipment.findByIdAndUpdate(
    id,
    {
      deliveryProof: {
        url: proofUrl,
        recipientSignatureName: proof.recipientSignatureName,
        notes: proof.notes,
        uploadedAt: new Date(),
      },
    },
    { new: true }
  );
  return shipment;
};

export const deleteShipmentService = async (id: string) => {
  const shipment = await Shipment.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });
  if (!shipment) return null;

  await Promise.all([
    Anomaly.updateMany({ shipmentId: id }, { deletedAt: new Date() }),
    Telemetry.updateMany({ shipmentId: id }, { deletedAt: new Date() }),
  ]);

  return shipment;
};
