import type { TelemetryThresholds } from '../../services/anomaly.service.js';
import { Shipment } from '../shipments/shipments.model.js';
import {
  DEFAULT_SHIPMENT_TYPE,
  DEFAULT_TELEMETRY_THRESHOLDS,
} from './telemetryThreshold.constants.js';
import { TelemetryThreshold } from './telemetryThreshold.model.js';
import type { UpdateTelemetryThresholdsInput } from './telemetry.validation.js';

function mergeWithDefaults(
  stored: Partial<TelemetryThresholds> | null | undefined
): TelemetryThresholds {
  return {
    maxTemp: stored?.maxTemp ?? DEFAULT_TELEMETRY_THRESHOLDS.maxTemp,
    minTemp: stored?.minTemp ?? null,
    maxHumidity: stored?.maxHumidity ?? DEFAULT_TELEMETRY_THRESHOLDS.maxHumidity,
    minHumidity: stored?.minHumidity ?? null,
    minBatteryLevel: stored?.minBatteryLevel ?? DEFAULT_TELEMETRY_THRESHOLDS.minBatteryLevel,
  };
}

export async function getOrgTelemetryThresholdsService(
  organizationId: string,
  shipmentType = DEFAULT_SHIPMENT_TYPE
): Promise<{ shipmentType: string; thresholds: TelemetryThresholds }> {
  const doc = await TelemetryThreshold.findOne({ organizationId, shipmentType }).lean();
  return {
    shipmentType,
    thresholds: mergeWithDefaults(doc ?? undefined),
  };
}

export async function updateOrgTelemetryThresholdsService(
  organizationId: string,
  input: UpdateTelemetryThresholdsInput
): Promise<{ shipmentType: string; thresholds: TelemetryThresholds }> {
  const shipmentType = input.shipmentType ?? DEFAULT_SHIPMENT_TYPE;
  const doc = await TelemetryThreshold.findOneAndUpdate(
    { organizationId, shipmentType },
    {
      organizationId,
      shipmentType,
      maxTemp: input.maxTemp ?? null,
      minTemp: input.minTemp ?? null,
      maxHumidity: input.maxHumidity ?? null,
      minHumidity: input.minHumidity ?? null,
      minBatteryLevel: input.minBatteryLevel ?? null,
    },
    { upsert: true, new: true, runValidators: true }
  ).lean();

  return {
    shipmentType,
    thresholds: mergeWithDefaults(doc),
  };
}

import mongoose from 'mongoose';

export async function resolveTelemetryThresholdsForShipment(
  shipmentId: string
): Promise<TelemetryThresholds> {
  if (!shipmentId || !mongoose.Types.ObjectId.isValid(shipmentId)) {
    return mergeWithDefaults(undefined);
  }

  const shipment = await Shipment.findById(shipmentId)
    .select({ enterpriseId: 1, offChainMetadata: 1 })
    .lean<{
      enterpriseId?: { toString: () => string } | string;
      offChainMetadata?: Record<string, unknown>;
    }>();

  if (!shipment) {
    return mergeWithDefaults(undefined);
  }

  const organizationId = shipment.enterpriseId?.toString();
  const rawType = shipment.offChainMetadata?.shipmentType;
  const shipmentType =
    typeof rawType === 'string' && rawType.trim().length > 0
      ? rawType.trim()
      : DEFAULT_SHIPMENT_TYPE;

  if (!organizationId) {
    return mergeWithDefaults(undefined);
  }

  const doc = await TelemetryThreshold.findOne({ organizationId, shipmentType }).lean();
  if (!doc && shipmentType !== DEFAULT_SHIPMENT_TYPE) {
    const fallback = await TelemetryThreshold.findOne({
      organizationId,
      shipmentType: DEFAULT_SHIPMENT_TYPE,
    }).lean();
    return mergeWithDefaults(fallback ?? undefined);
  }

  return mergeWithDefaults(doc ?? undefined);
}
