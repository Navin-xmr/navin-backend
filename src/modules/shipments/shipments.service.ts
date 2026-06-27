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
import { invalidateAnalyticsPerformanceCache } from '../analytics/analytics.cache.js';
import * as paymentsRepo from '../payments/payments.repo.js';
import { PaymentStatus } from '../payments/payments.model.js';
import {
  readShipmentEtaCache,
  writeShipmentEtaCache,
  invalidateShipmentEtaCache,
  type ShipmentEtaPayload,
} from './shipmentsEta.cache.js';

type ShipmentListResult = {
  data: IShipment[];
  page: number;
  limit: number;
  total: number;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

type TelemetryPoint = {
  latitude: number;
  longitude: number;
  timestamp: Date;
};

const ETA_POINTS_WINDOW = 8;
const MIN_EFFECTIVE_SPEED_KMH = 5;
const DEFAULT_SINGLE_POINT_SPEED_KMH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function extractCoordinates(value: unknown): Coordinates | null {
  if (!isRecord(value)) {
    return null;
  }

  const latitude = readNumberField(value, ['latitude', 'lat']);
  const longitude = readNumberField(value, ['longitude', 'lng', 'lon']);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function resolveDestinationCoordinates(metadata: unknown): Coordinates | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const direct = extractCoordinates(metadata.destinationCoordinates);
  if (direct) {
    return direct;
  }

  const nestedDestination = extractCoordinates(metadata.destination);
  if (nestedDestination) {
    return nestedDestination;
  }

  const route = isRecord(metadata.route) ? metadata.route : null;
  const routeDestination = route ? extractCoordinates(route.destination) : null;
  if (routeDestination) {
    return routeDestination;
  }

  return null;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function calculateDistanceKm(from: Coordinates, to: Coordinates): number {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function calculateAverageSpeedKmh(points: TelemetryPoint[]): number {
  if (points.length < 2) {
    return DEFAULT_SINGLE_POINT_SPEED_KMH;
  }

  const chronological = [...points].reverse();
  let distanceKm = 0;
  let elapsedHours = 0;

  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1];
    const current = chronological[index];

    const segmentHours = (current.timestamp.getTime() - previous.timestamp.getTime()) / 3600000;
    if (segmentHours <= 0) {
      continue;
    }

    distanceKm += calculateDistanceKm(previous, current);
    elapsedHours += segmentHours;
  }

  if (elapsedHours <= 0) {
    return DEFAULT_SINGLE_POINT_SPEED_KMH;
  }

  return distanceKm / elapsedHours;
}

function inferEtaConfidence(pointsCount: number, averageSpeed: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (pointsCount >= 6 && averageSpeed >= 15) {
    return 'HIGH';
  }

  if (pointsCount >= 3 && averageSpeed >= 8) {
    return 'MEDIUM';
  }

  return 'LOW';
}

export const findShipments = async (
  query: FilterQuery<unknown>,
  skip: number,
  limit: number
): Promise<IShipment[]> => {
  return Shipment.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean();
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
  await invalidateShipmentEtaCache(id);

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
          console.log(
            `[Shipment] Escrow released for shipment ${id}, ` +
              `tx: ${releaseResult.transactionHash}`
          );
        }
      }
    } catch (escrowError) {
      console.warn(`[Shipment] Failed to trigger escrow release for ${id}:`, escrowError);
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

export const deleteShipmentService = async (id: string) => {
  const shipment = await Shipment.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });
  if (!shipment) return null;

  await Promise.all([
    Anomaly.updateMany({ shipmentId: id }, { deletedAt: new Date() }),
    Telemetry.updateMany({ shipmentId: id }, { deletedAt: new Date() }),
  ]);

  return shipment;
};

export const getShipmentEtaService = async (id: string): Promise<ShipmentEtaPayload> => {
  const cached = await readShipmentEtaCache(id);
  if (cached) {
    return cached;
  }

  const shipment = await Shipment.findById(id).lean();
  if (!shipment) {
    throw new AppError(404, 'Shipment not found', 'ERR_SHIPMENT_NOT_FOUND');
  }

  if (shipment.status !== ShipmentStatus.IN_TRANSIT) {
    const nonTransitPayload: ShipmentEtaPayload = {
      estimatedArrival: null,
      reason: `ETA is available only for ${ShipmentStatus.IN_TRANSIT} shipments`,
    };
    await writeShipmentEtaCache(id, nonTransitPayload);
    return nonTransitPayload;
  }

  const destination = resolveDestinationCoordinates(shipment.offChainMetadata);
  if (!destination) {
    throw new AppError(
      400,
      'Destination coordinates are missing in shipment metadata',
      'ERR_SHIPMENT_ETA_DESTINATION_MISSING'
    );
  }

  const points = (await Telemetry.find({ shipmentId: id })
    .select('latitude longitude timestamp')
    .sort({ timestamp: -1, _id: -1 })
    .limit(ETA_POINTS_WINDOW)
    .lean()) as TelemetryPoint[];

  if (points.length === 0) {
    throw new AppError(404, 'No GPS telemetry data points found', 'ERR_SHIPMENT_ETA_NO_GPS');
  }

  const latest = points[0];
  const distanceRemaining = calculateDistanceKm(latest, destination);
  const averageSpeedRaw = calculateAverageSpeedKmh(points);
  const averageSpeed = Math.max(averageSpeedRaw, MIN_EFFECTIVE_SPEED_KMH);
  const confidence = inferEtaConfidence(points.length, averageSpeedRaw);
  const etaHours = distanceRemaining / averageSpeed;
  const estimatedArrival = new Date(Date.now() + etaHours * 3600000).toISOString();

  const payload: ShipmentEtaPayload = {
    estimatedArrival,
    distanceRemaining: Number(distanceRemaining.toFixed(3)),
    averageSpeed: Number(averageSpeed.toFixed(3)),
    confidence,
  };

  await writeShipmentEtaCache(id, payload);
  return payload;
};
