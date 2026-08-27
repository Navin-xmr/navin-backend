import { Shipment } from './shipments.model.js';
import type { FilterQuery, SortOrder } from 'mongoose';
import { tokenizeShipment, releaseEscrow } from '../../services/stellar.service.js';
import { uploadFileToStorage } from '../../services/storage/upload.js';
import {
  generateProofKey,
  generateDocumentKey,
  generatePhotoKey,
  generateDisputeEvidenceKey,
} from '../../services/storage/keyGenerator.js';
import { UserModel } from '../users/users.model.js';
import { emitStatusUpdate } from '../../infra/socket/io.js';
import { Anomaly } from '../anomaly/anomaly.model.js';
import { Telemetry } from '../telemetry/telemetry.model.js';
import { TelemetryAnchorStatus } from '../../shared/types/telemetry.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import {
  IShipment,
  ShipmentStatus,
  MilestoneEvent,
  type ShipmentDocumentType,
  type IDispute,
  type DisputeType,
} from '../../shared/types/shipment.js';
import { auditLog } from '../../shared/utils/auditLog.js';
import { logger } from '../../shared/logger/logger.js';
import { invalidateAnalyticsPerformanceCache } from '../analytics/analytics.cache.js';
import * as paymentsRepo from '../payments/payments.repo.js';
import { PaymentStatus } from '../payments/payments.model.js';
import { validateStatusTransition } from '../../shared/constants/shipmentStateMachine.js';
import { createLedgerBlockService } from '../ledger/ledger.service.js';

import { offsetSkip } from '../../shared/utils/pagination.js';
import {
  readShipmentEtaCache,
  writeShipmentEtaCache,
  invalidateShipmentEtaCache,
  type ShipmentEtaPayload,
} from './shipmentsEta.cache.js';
import { isAuthorizedForShipment } from '../../infra/socket/shipmentRooms.js';
import { UserRole } from '../../shared/constants/index.js';

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
  limit: number,
  sort: Record<string, SortOrder> = { createdAt: -1, _id: -1 }
): Promise<IShipment[]> => {
  return Shipment.find(query).sort(sort).skip(skip).limit(limit).lean();
};

/**
 * Retrieves a paginated list of shipments using filters and optional search criteria.
 * @param {object} params - Pagination and filter parameters.
 * @returns {Promise<ShipmentListResult>} Paginated shipment results.
 */
export const getShipmentsService = async (params: {
  status?: string | string[];
  priority?: string | string[];
  page: number;
  limit: number;
  origin?: string;
  destination?: string;
  trackingNumber?: string;
  q?: string;
  from?: Date;
  to?: Date;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters: Record<string, unknown>;
}): Promise<ShipmentListResult> => {
  const {
    status,
    priority,
    page,
    limit,
    origin,
    destination,
    trackingNumber,
    q,
    from,
    to,
    sortBy,
    sortOrder,
    filters,
  } = params;
  const query: FilterQuery<unknown> = {};

  if (filters.organizationId) {
    query.organizationId = filters.organizationId;
  }

  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    query.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  if (trackingNumber) {
    const escaped = trackingNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.trackingNumber = { $regex: escaped, $options: 'i' };
  }

  if (origin) {
    const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.origin = { $regex: escapedOrigin, $options: 'i' };
  }
  if (destination) {
    const escapedDestination = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.destination = { $regex: escapedDestination, $options: 'i' };
  }

  if (q) {
    // Uses text index on trackingNumber, origin, destination
    query.$text = { $search: q };
  }

  if (from || to) {
    const createdAt: { $gte?: Date; $lte?: Date } = {};
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    query.createdAt = createdAt;
  }

  if (priority) {
    const priorities = Array.isArray(priority) ? priority : [priority];
    query.priority = priorities.length === 1 ? priorities[0] : { $in: priorities };
  }

  const sort: Record<string, SortOrder> = {};
  if (sortBy) {
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
  } else {
    sort['createdAt'] = -1;
  }
  sort['_id'] = sortOrder === 'asc' ? 1 : -1; // deterministic tie-breaker

  const skip = offsetSkip(page, limit);
  const [data, total] = await Promise.all([
    findShipments(query, skip, limit, sort),
    Shipment.countDocuments(query),
  ]);

  return { data, page, limit, total };
};

export const getShipmentByIdService = async (
  id: string,
  context?: { organizationId?: string; role?: string }
): Promise<IShipment> => {
  const shipment = await Shipment.findById(id).lean<IShipment>();
  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
  }

  const isSuperAdmin = context?.role === UserRole.SUPER_ADMIN;
  if (!isSuperAdmin) {
    if (!context?.organizationId) {
      throw new AppError(403, 'Forbidden: insufficient access to shipment', ErrorCodes.FORBIDDEN);
    }
    const authorized = await isAuthorizedForShipment({
      shipmentId: id,
      organizationId: context.organizationId,
    });
    if (!authorized) {
      throw new AppError(403, 'Forbidden: insufficient access to shipment', ErrorCodes.FORBIDDEN);
    }
  }

  return shipment;
};

export type ShipmentTimelineEventType =
  'STATUS_CHANGE' | 'TELEMETRY_ANCHORED' | 'ANOMALY_DETECTED' | 'PROOF_UPLOADED';

export interface ShipmentTimelineEvent {
  type: ShipmentTimelineEventType;
  timestamp: string;
  description: string;
  metadata: Record<string, unknown>;
}

type TimelineEventWithCursor = ShipmentTimelineEvent & { cursorKey: string };

/**
 * Builds a stable opaque cursor key for timeline pagination.
 * Format: `{ISO-8601 timestamp}|{source-suffix}` so events that share a
 * timestamp remain uniquely addressable and sort deterministically.
 */
function buildTimelineCursorKey(timestamp: string, suffix: string): string {
  return `${timestamp}|${suffix}`;
}

/**
 * Aggregates a paginated shipment timeline from multiple event sources.
 *
 * **Aggregation algorithm**
 * 1. Load the shipment (auth-scoped) and map each milestone to a `STATUS_CHANGE` event.
 * 2. If delivery proof has an `uploadedAt`, emit a single `PROOF_UPLOADED` event.
 * 3. In parallel (`Promise.all`), fetch Stellar-anchored telemetry rows and all anomalies,
 *    then map them to `TELEMETRY_ANCHORED` / `ANOMALY_DETECTED` events respectively.
 * 4. Union all events into one in-memory array, attach a `cursorKey` per event, then sort
 *    ascending by `timestamp`, breaking ties with `cursorKey` lexicographic order.
 * 5. Cursor pagination: if `params.cursor` matches a `cursorKey`, the page starts at the
 *    next event; otherwise pagination starts from the beginning. Fetch `limit + 1` items
 *    to compute `hasMore`, then strip internal `cursorKey` fields from the response.
 *
 * No Redis/response caching — every call re-aggregates from live documents.
 *
 * @param {string} id - Shipment ObjectId.
 * @param {object} params - Pagination and authorization parameters.
 * @param {string=} params.cursor - Opaque cursor from a previous page (`timestamp|suffix`).
 * @param {number} params.limit - Maximum events to return in this page.
 * @param {string=} params.organizationId - Caller organization for access control.
 * @param {string=} params.role - Caller role for access control.
 * @returns {Promise<{ data: ShipmentTimelineEvent[]; nextCursor: string | null; hasMore: boolean }>}
 *   Sorted timeline page plus cursor metadata for the next page.
 */
export const getShipmentTimelineService = async (
  id: string,
  params: { cursor?: string; limit: number; organizationId?: string; role?: string }
): Promise<{ data: ShipmentTimelineEvent[]; nextCursor: string | null; hasMore: boolean }> => {
  const shipment = await getShipmentByIdService(id, {
    organizationId: params.organizationId,
    role: params.role,
  });

  const events: TimelineEventWithCursor[] = [];

  for (const milestone of shipment.milestones ?? []) {
    const timestamp = new Date(milestone.timestamp).toISOString();
    events.push({
      type: 'STATUS_CHANGE',
      timestamp,
      description: milestone.description ?? `Status changed to ${milestone.name}`,
      metadata: {
        status: milestone.name,
        userId: milestone.userId,
        walletAddress: milestone.walletAddress,
      },
      // Cursor key: ISO timestamp + status suffix for stable pagination across equal times.
      cursorKey: buildTimelineCursorKey(timestamp, `status-${milestone.name}`),
    });
  }

  const proof = shipment.deliveryProof as
    | {
        url?: string;
        recipientSignatureName?: string;
        notes?: string;
        uploadedAt?: Date | string;
      }
    | undefined;

  if (proof?.uploadedAt) {
    const timestamp = new Date(proof.uploadedAt).toISOString();
    events.push({
      type: 'PROOF_UPLOADED',
      timestamp,
      description: 'Proof of delivery uploaded',
      metadata: {
        url: proof.url,
        recipientSignatureName: proof.recipientSignatureName,
        notes: proof.notes,
      },
      // Cursor key: ISO timestamp + fixed "proof" suffix (at most one proof event).
      cursorKey: buildTimelineCursorKey(timestamp, 'proof'),
    });
  }

  // Parallel fetch: union of anchored telemetry + anomalies into the same event stream.
  const [telemetryRows, anomalyRows] = await Promise.all([
    Telemetry.find({ shipmentId: id, anchorStatus: TelemetryAnchorStatus.ANCHORED }).lean(),
    Anomaly.find({ shipmentId: id }).lean(),
  ]);

  for (const row of telemetryRows) {
    const timestamp = new Date(row.timestamp).toISOString();
    events.push({
      type: 'TELEMETRY_ANCHORED',
      timestamp,
      description: 'Telemetry record anchored on Stellar',
      metadata: {
        telemetryId: row._id.toString(),
        stellarTxHash: row.stellarTxHash,
        dataHash: row.dataHash,
      },
      // Cursor key: ISO timestamp + telemetry document id for uniqueness.
      cursorKey: buildTimelineCursorKey(timestamp, `telemetry-${row._id.toString()}`),
    });
  }

  for (const row of anomalyRows) {
    const timestamp = new Date(row.timestamp).toISOString();
    events.push({
      type: 'ANOMALY_DETECTED',
      timestamp,
      description: row.message,
      metadata: {
        anomalyId: row._id.toString(),
        type: row.type,
        severity: row.severity,
        resolved: row.resolved,
      },
      // Cursor key: ISO timestamp + anomaly document id for uniqueness.
      cursorKey: buildTimelineCursorKey(timestamp, `anomaly-${row._id.toString()}`),
    });
  }

  events.sort((a, b) => {
    const byTime = a.timestamp.localeCompare(b.timestamp);
    if (byTime !== 0) return byTime;
    return a.cursorKey.localeCompare(b.cursorKey);
  });

  let startIndex = 0;
  if (params.cursor) {
    const cursorIndex = events.findIndex(event => event.cursorKey === params.cursor);
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  }

  const page = events.slice(startIndex, startIndex + params.limit + 1);
  const hasMore = page.length > params.limit;
  const pageEvents = hasMore ? page.slice(0, params.limit) : page;
  const nextCursor =
    hasMore && pageEvents.length > 0 ? pageEvents[pageEvents.length - 1].cursorKey : null;

  const data = pageEvents.map(({ cursorKey: _cursorKey, ...event }) => event);

  return { data, nextCursor, hasMore };
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
  actorUserId?: string;
  [key: string]: unknown;
}) => {
  const { actorUserId, ...shipmentData } = data;
  const trackingNumber =
    shipmentData.trackingNumber || `NVN-${Math.floor(100000 + Math.random() * 900000)}`;
  const shipment = new Shipment({ ...shipmentData, trackingNumber });
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

  auditLog({
    userId: actorUserId ?? 'system',
    action: 'SHIPMENT_CREATED',
    resourceId: shipment._id.toString(),
    timestamp: new Date(),
    metadata: {
      trackingNumber: shipment.trackingNumber,
      origin: shipment.origin,
      destination: shipment.destination,
    },
  });

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
 * @throws {AppError} 400 when the status transition is invalid.
 */
export const updateShipmentStatusService = async (
  id: string,
  status: ShipmentStatus,
  actor?: { userId?: string; walletAddress?: string }
) => {
  const shipment = await Shipment.findById(id);
  if (!shipment) return null;

  if (shipment.status === status) return shipment;

  validateStatusTransition(shipment.status as ShipmentStatus, status);

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

  // Write ledger block for every status change
  try {
    await createLedgerBlockService({
      shipmentId: id,
      eventType: status as unknown as MilestoneEvent,
      transactionHash: shipment.stellarTxHash ?? undefined,
      actor: actor?.userId,
      metadata: { previousStatus },
    });
  } catch (ledgerErr) {
    logger.warn(
      { err: ledgerErr, shipmentId: id, status },
      'Failed to create ledger block for status change'
    );
  }

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

          // Write ledger block for settlement initiation
          try {
            await createLedgerBlockService({
              shipmentId: id,
              eventType: MilestoneEvent.SETTLEMENT_INITIATED,
              transactionHash: releaseResult.transactionHash,
              actor: actor?.userId,
              metadata: { paymentId: payment._id.toString() },
            });
          } catch (settlementLedgerErr) {
            logger.warn(
              { err: settlementLedgerErr, shipmentId: id },
              'Failed to create ledger block for settlement initiation'
            );
          }

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
  proof: { recipientSignatureName?: string; notes?: string; actorUserId?: string }
) => {
  let proofUrl: string;

  try {
    const key = generateProofKey(id, file.originalname);
    proofUrl = await uploadFileToStorage(file.buffer, file.mimetype, key);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
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

  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
  }

  // Write PROOF_SUBMITTED ledger block
  try {
    await createLedgerBlockService({
      shipmentId: id,
      milestoneEvent: MilestoneEvent.PROOF_SUBMITTED,
      shipmentReference: shipment?.trackingNumber,
      transactionHash: shipment?.stellarTxHash ?? undefined,
      metadata: {
        proofUrl,
        recipientSignatureName: proof.recipientSignatureName,
      },
    });
  } catch (ledgerErr) {
    logger.warn(
      { err: ledgerErr, shipmentId: id },
      'Failed to create ledger block for proof upload'
    );
  }

  if (proof.actorUserId) {
    auditLog({
      userId: proof.actorUserId,
      action: 'PROOF_UPLOADED',
      resourceId: id,
      timestamp: new Date(),
      metadata: { proofUrl, recipientSignatureName: proof.recipientSignatureName },
    });
  }

  return shipment;
};

/**
 * Creates a dispute and attaches it to a shipment.
 * @param {string} id - Shipment ObjectId.
 * @param {Express.Multer.File | undefined} file - Optional evidence file upload.
 * @param {{type: string; description: string}} data - Dispute data.
 * @returns {Promise<unknown>} The created dispute object.
 * @throws {AppError} When storage upload fails or shipment not found.
 */
export const createDisputeService = async (
  id: string,
  file: Express.Multer.File | undefined,
  data: { type: string; description: string; actorUserId?: string }
) => {
  let evidenceUrl: string | undefined;

  if (file) {
    try {
      const key = generateDisputeEvidenceKey(id, `dispute-${Date.now()}`, file.originalname);
      evidenceUrl = await uploadFileToStorage(file.buffer, file.mimetype, key);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        503,
        'Storage bucket unavailable, please try again later.',
        'SERVICE_UNAVAILABLE'
      );
    }
  }

  const shipment = await Shipment.findById(id);
  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
  }

  const referenceNumber = `DSP-${Math.floor(100000 + Math.random() * 900000)}`;

  const dispute: IDispute = {
    referenceNumber,
    status: 'PENDING',
    type: data.type as DisputeType,
    description: data.description,
    evidenceUrl,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  shipment.disputes.push(dispute);
  await shipment.save();

  if (data.actorUserId) {
    auditLog({
      userId: data.actorUserId,
      action: 'DISPUTE_OPENED',
      resourceId: id,
      timestamp: new Date(),
      metadata: { type: data.type, referenceNumber },
    });
  }

  // Return the newly created dispute (the last one in the array)
  return shipment.disputes[shipment.disputes.length - 1];
};

const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const PHOTO_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_PHOTOS_PER_SHIPMENT = 10;

export const DOCUMENT_UPLOAD_CONSTRAINTS = {
  mimeTypes: DOCUMENT_MIME_TYPES,
  maxSize: DOCUMENT_MAX_SIZE,
} as const;

export const PHOTO_UPLOAD_CONSTRAINTS = {
  mimeTypes: PHOTO_MIME_TYPES,
  maxSize: PHOTO_MAX_SIZE,
  maxPerShipment: MAX_PHOTOS_PER_SHIPMENT,
} as const;

export const uploadShipmentDocumentService = async (
  id: string,
  file: Express.Multer.File,
  docType: ShipmentDocumentType,
  userId?: string
) => {
  let fileUrl: string;

  try {
    const key = generateDocumentKey(id, docType, file.originalname);
    fileUrl = await uploadFileToStorage(file.buffer, file.mimetype, key);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      503,
      'Storage bucket unavailable, please try again later.',
      'SERVICE_UNAVAILABLE'
    );
  }

  const shipment = await Shipment.findById(id);
  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
  }

  const document = {
    url: fileUrl,
    fileName: file.originalname,
    mimeType: file.mimetype,
    type: docType,
    size: file.size,
    uploadedBy: userId,
    uploadedAt: new Date(),
  };

  shipment.documents.push(document as never);
  await shipment.save();

  return shipment.documents[shipment.documents.length - 1];
};

export const uploadShipmentPhotoService = async (
  id: string,
  file: Express.Multer.File,
  caption?: string,
  userId?: string
) => {
  let fileUrl: string;

  try {
    const key = generatePhotoKey(id, file.originalname);
    fileUrl = await uploadFileToStorage(file.buffer, file.mimetype, key);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      503,
      'Storage bucket unavailable, please try again later.',
      'SERVICE_UNAVAILABLE'
    );
  }

  const shipment = await Shipment.findById(id);
  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
  }

  if (shipment.photos.length >= MAX_PHOTOS_PER_SHIPMENT) {
    throw new AppError(
      400,
      `Maximum ${MAX_PHOTOS_PER_SHIPMENT} photos per shipment`,
      ErrorCodes.PHOTO_LIMIT_EXCEEDED
    );
  }

  const photo = {
    url: fileUrl,
    fileName: file.originalname,
    mimeType: file.mimetype,
    caption,
    size: file.size,
    uploadedBy: userId,
    uploadedAt: new Date(),
  };

  shipment.photos.push(photo as never);
  await shipment.save();

  return shipment.photos[shipment.photos.length - 1];
};

const EXPORT_MAX_RECORDS = 10_000;

/**
 * Exports shipments matching the given filters as an array (max 10,000).
 * Returns 400 if the result set exceeds the limit.
 */
export const exportShipmentsService = async (params: {
  organizationId?: string;
  status?: string;
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
}): Promise<IShipment[]> => {
  const { organizationId, status, origin, destination, startDate, endDate } = params;
  const query: FilterQuery<unknown> = {};

  if (organizationId) query.organizationId = organizationId;
  if (status) query.status = status;
  if (origin) {
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.origin = { $regex: escaped, $options: 'i' };
  }
  if (destination) {
    const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.destination = { $regex: escaped, $options: 'i' };
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) (query.createdAt as Record<string, unknown>).$gte = new Date(startDate);
    if (endDate) (query.createdAt as Record<string, unknown>).$lte = new Date(endDate);
  }

  const count = await Shipment.countDocuments(query);
  if (count > EXPORT_MAX_RECORDS) {
    throw new AppError(
      400,
      `Export exceeds ${EXPORT_MAX_RECORDS} records (${count} found). Please narrow your filters.`,
      'EXPORT_TOO_LARGE'
    );
  }

  return Shipment.find(query).sort({ createdAt: -1 }).limit(EXPORT_MAX_RECORDS).lean();
};

/**
 * Converts shipment records to CSV string.
 */
export function shipmentsToCSV(shipments: IShipment[]): string {
  const headers = [
    '_id',
    'trackingNumber',
    'origin',
    'destination',
    'status',
    'createdAt',
    'updatedAt',
  ];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = shipments.map(s =>
    headers.map(h => escape((s as unknown as Record<string, unknown>)[h])).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

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

/**
 * Estimates arrival time for an in-transit shipment from recent GPS telemetry.
 *
 * **Aggregation algorithm**
 * 1. **Cache lookup** — return a Redis-cached payload when present (TTL managed by
 *    `shipmentsEta.cache`; both success and non-transit reason payloads are cached).
 * 2. Load the shipment; if status is not `IN_TRANSIT`, cache and return a null ETA with reason.
 * 3. Resolve destination coordinates from off-chain metadata (`destinationCoordinates`,
 *    nested `destination`, or `route.destination`).
 * 4. Fetch up to `ETA_POINTS_WINDOW` most recent GPS points (sorted newest-first).
 * 5. Distance remaining = Haversine from the latest point to the destination.
 * 6. Average speed = distance/time across chronological segments of the window
 *    (floored to `MIN_EFFECTIVE_SPEED_KMH`; single-point fallback uses a default speed).
 * 7. ETA hours = distanceRemaining / averageSpeed; confidence is inferred from sample
 *    size and raw average speed. Persist the payload to Redis before returning.
 *
 * @param {string} id - Shipment ObjectId.
 * @returns {Promise<ShipmentEtaPayload>} Estimated arrival with distance/speed/confidence,
 *   or `{ estimatedArrival: null, reason }` when the shipment is not in transit.
 */
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

  // Recent GPS window (newest first) used for speed + remaining-distance aggregation.
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
