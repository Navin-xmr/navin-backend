import { Shipment } from './shipments.model.js';
import type { FilterQuery } from 'mongoose';
import { tokenizeShipment, releaseEscrow } from '../../services/stellar.service.js';
import { mockUploadToStorage } from '../../services/mockStorageService.js';
import { UserModel } from '../users/users.model.js';
import { emitStatusUpdate } from '../../infra/socket/io.js';
import { Anomaly } from '../anomaly/anomaly.model.js';
import { Telemetry } from '../telemetry/telemetry.model.js';
import { AppError } from '../../shared/http/errors.js';
import { IShipment, ShipmentStatus } from '../../shared/types/shipment.js';
import { auditLog } from '../../shared/utils/auditLog.js';
import { logger } from '../../shared/logger/logger.js';
import { invalidateAnalyticsPerformanceCache } from '../analytics/analytics.cache.js';
import * as paymentsRepo from '../payments/payments.repo.js';
import { PaymentStatus } from '../payments/payments.model.js';

type ShipmentListResult = {
  data: IShipment[];
  page: number;
  limit: number;
  total: number;
};

/**
 * Queries shipments directly by filter, skip, and limit.
 * @param {FilterQuery<unknown>} query - MongoDB filter query.
 * @param {number} skip - Number of records to skip.
 * @param {number} limit - Maximum number of records to return.
 * @returns {Promise<IShipment[]>} Matching shipment documents.
 */
export const findShipments = async (
  query: FilterQuery<unknown>,
  skip: number,
  limit: number
): Promise<IShipment[]> => {
  return Shipment.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean();
};

/**
 * Retrieves a paginated list of shipments using filters and optional search criteria.
 * @param {object} params - Pagination and filter parameters.
 * @param {string=} params.status - Optional shipment status filter.
 * @param {number} params.page - Page number starting at 1.
 * @param {number} params.limit - Page size.
 * @param {string=} params.origin - Optional origin substring filter.
 * @param {string=} params.destination - Optional destination substring filter.
 * @param {Record<string, unknown>} params.filters - Additional query filters.
 * @returns {Promise<ShipmentListResult>} Paginated shipment results.
 */
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

/**
 * Creates a new shipment record and attempts Stellar tokenization.
 * @param {object} data - Shipment creation payload.
 * @param {string=} data.trackingNumber - Optional tracking number.
 * @param {string} data.origin - Shipment origin.
 * @param {string} data.destination - Shipment destination.
 * @returns {Promise<unknown>} Created shipment document.
 */
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
    logger.warn({ err, shipmentId: shipment._id.toString() }, 'Stellar tokenization skipped');
  }

  return shipment;
};

/**
 * Updates shipment off-chain metadata.
 * @param {string} id - Shipment ObjectId.
 * @param {unknown} offChainMetadata - Off-chain metadata payload.
 * @returns {Promise<unknown>} Updated shipment document.
 */
export const patchShipmentService = async (id: string, offChainMetadata: unknown) => {
  return Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
};

/**
 * Updates a shipment's status, records a milestone, and emits status events.
 * @param {string} id - Shipment ObjectId.
 * @param {ShipmentStatus} status - New shipment status.
 * @param {{userId?: string; walletAddress?: string}=} actor - Optional actor metadata.
 * @returns {Promise<unknown>} Updated shipment document or null when not found.
 */
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

  // Trigger escrow release on delivery
  if (status === ShipmentStatus.DELIVERED) {
    try {
      const payment = await paymentsRepo.getPaymentByShipmentId(shipment._id.toString());
      if (payment) {
        const releaseResult = await releaseEscrow({
          paymentId: payment._id.toString(),
          shipmentId: shipment._id.toString(),
        });

        if (releaseResult.success && releaseResult.transactionHash) {
          await paymentsRepo.updatePaymentStatus(
            payment._id.toString(),
            PaymentStatus.RELEASED,
            releaseResult.transactionHash
          );
          logger.info(
            { shipmentId: id, transactionHash: releaseResult.transactionHash },
            'Escrow released for shipment'
          );
        }
      }
    } catch (escrowError) {
      logger.warn({ err: escrowError, shipmentId: id }, 'Failed to trigger escrow release');
      // Don't fail the shipment status update if escrow release fails
      // The payment status can be manually updated later via webhook
    }
  }

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
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
      description: m.description ?? undefined,
      userId: m.userId?.toString() ?? undefined,
      walletAddress: m.walletAddress ?? undefined,
    })),
    updatedAt:
      shipment.updatedAt instanceof Date ? shipment.updatedAt.toISOString() : shipment.updatedAt,
  });

  return shipment;
};

/**
 * Uploads delivery proof and attaches it to a shipment.
 * @param {string} id - Shipment ObjectId.
 * @param {Express.Multer.File} file - Proof file upload.
 * @param {{recipientSignatureName?: string; notes?: string}} proof - Proof metadata.
 * @returns {Promise<unknown>} Updated shipment document.
 * @throws {AppError} When storage upload fails.
 */
export const uploadShipmentProofService = async (
  id: string,
  file: Express.Multer.File,
  proof: { recipientSignatureName?: string; notes?: string }
) => {
  let proofUrl: string;

  try {
    proofUrl = await mockUploadToStorage(file);
  } catch {
    throw new AppError(
      503,
      'Storage bucket unavailable, please try again later.',
      'SERVICE_UNAVAILABLE'
    );
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

/**
 * Soft deletes a shipment and cascades deletion markers to related telemetry and anomaly documents.
 * @param {string} id - Shipment ObjectId.
 * @returns {Promise<unknown>} Deleted shipment document or null.
 */
export const deleteShipmentService = async (id: string) => {
  const shipment = await Shipment.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });
  if (!shipment) return null;

  await Promise.all([
    Anomaly.updateMany({ shipmentId: id }, { deletedAt: new Date() }),
    Telemetry.updateMany({ shipmentId: id }, { deletedAt: new Date() }),
  ]);

  return shipment;
};
