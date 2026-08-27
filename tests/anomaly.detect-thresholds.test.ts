import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { Types } from 'mongoose';

const ORG_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const thresholdStore: Array<{
  organizationId: string;
  shipmentType: string;
  maxTemp?: number | null;
  maxHumidity?: number | null;
  minBatteryLevel?: number | null;
}> = [];

const shipmentStore: Array<{
  _id: string;
  enterpriseId: string;
  offChainMetadata?: Record<string, unknown>;
}> = [];

await jest.unstable_mockModule('../src/modules/telemetry/telemetryThreshold.model.js', () => ({
  TelemetryThreshold: {
    findOne: (query: { organizationId: string; shipmentType: string }) => ({
      lean: () =>
        Promise.resolve(
          thresholdStore.find(
            t =>
              t.organizationId === String(query.organizationId) &&
              t.shipmentType === query.shipmentType
          ) ?? null
        ),
    }),
  },
}));

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: (id: string) => ({
      select: () => ({
        lean: () => Promise.resolve(shipmentStore.find(s => s._id === id) ?? null),
      }),
    }),
  },
}));

await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
  Anomaly: {
    create: jest.fn((docs: unknown[]) =>
      Promise.resolve(
        (Array.isArray(docs) ? docs : [docs]).map((doc, i) => ({
          toObject: () => ({ ...(doc as object), _id: `a${i}` }),
        }))
      )
    ),
  },
}));

const { detectAnomaly } = await import('../src/modules/anomaly/anomaly.service.js');
const { resolveTelemetryThresholdsForShipment } = await import(
  '../src/modules/telemetry/telemetryThreshold.service.js'
);
const {
  DEFAULT_TELEMETRY_THRESHOLDS,
  DEFAULT_SHIPMENT_TYPE,
} = await import('../src/modules/telemetry/telemetryThreshold.constants.js');

describe('Configurable anomaly thresholds', () => {
  const shipmentId = new Types.ObjectId().toString();

  beforeEach(() => {
    thresholdStore.length = 0;
    shipmentStore.length = 0;
  });

  it('falls back to global defaults when org has no config', async () => {
    shipmentStore.push({ _id: shipmentId, enterpriseId: ORG_ID });
    const thresholds = await resolveTelemetryThresholdsForShipment(shipmentId);
    expect(thresholds.maxTemp).toBe(DEFAULT_TELEMETRY_THRESHOLDS.maxTemp);
  });

  it('detectAnomaly uses custom refrigerated thresholds', async () => {
    shipmentStore.push({
      _id: shipmentId,
      enterpriseId: ORG_ID,
      offChainMetadata: { shipmentType: 'REFRIGERATED' },
    });
    thresholdStore.push({
      organizationId: ORG_ID,
      shipmentType: 'REFRIGERATED',
      maxTemp: 5,
      maxHumidity: 80,
      minBatteryLevel: 20,
    });

    const result = await detectAnomaly({
      _id: new Types.ObjectId().toString(),
      shipmentId,
      temperature: 10,
      humidity: 50,
      batteryLevel: 90,
    });

    expect(result.detected).toBe(true);
    expect(result.anomalies[0]?.type).toBe('TEMPERATURE_EXCEEDED');
  });

  it('falls back to default-type thresholds when the shipment type has no config', async () => {
    shipmentStore.push({
      _id: shipmentId,
      enterpriseId: ORG_ID,
      offChainMetadata: { shipmentType: 'REFRIGERATED' },
    });
    thresholdStore.push({
      organizationId: ORG_ID,
      shipmentType: DEFAULT_SHIPMENT_TYPE,
      maxTemp: 5,
    });

    const thresholds = await resolveTelemetryThresholdsForShipment(shipmentId);
    expect(thresholds.maxTemp).toBe(5);
  });

  it('detectAnomaly uses custom humidity and battery thresholds', async () => {
    shipmentStore.push({
      _id: shipmentId,
      enterpriseId: ORG_ID,
      offChainMetadata: { shipmentType: 'REFRIGERATED' },
    });
    thresholdStore.push({
      organizationId: ORG_ID,
      shipmentType: 'REFRIGERATED',
      maxTemp: 5,
      maxHumidity: 50,
      minBatteryLevel: 60,
    });

    const result = await detectAnomaly({
      _id: new Types.ObjectId().toString(),
      shipmentId,
      temperature: 3,
      humidity: 90,
      batteryLevel: 20,
    });

    expect(result.detected).toBe(true);
    const types = result.anomalies.map(a => a.type);
    expect(types).toContain('HUMIDITY_EXCEEDED');
    expect(types).toContain('BATTERY_LOW');
  });
});
