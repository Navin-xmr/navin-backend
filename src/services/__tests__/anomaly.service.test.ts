import { evaluateTelemetry } from '../anomaly.service.js';

describe('evaluateTelemetry', () => {
  const basePayload = {
    shipmentId: '507f1f77bcf86cd799439011',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('returns [] for normal conditions (edge values inclusive)', () => {
    const anomalies = evaluateTelemetry(
      { ...basePayload, temperature: 10, humidity: 60, batteryLevel: 20 },
      { maxTemp: 10, maxHumidity: 60, minBatteryLevel: 20, minTemp: 10, minHumidity: 60 },
    );
    expect(anomalies).toEqual([]);
  });

  it('returns [] when thresholds are missing', () => {
    const anomalies = evaluateTelemetry({ ...basePayload, temperature: 999, humidity: 999, batteryLevel: 0 }, {});
    expect(anomalies).toEqual([]);
  });

  it('returns [] when payload is missing required identity fields', () => {
    expect(evaluateTelemetry({ shipmentId: '', timestamp: new Date() }, { maxTemp: 1 })).toEqual([]);
    expect(evaluateTelemetry({ shipmentId: 'x', timestamp: new Date('bad') }, { maxTemp: 1 })).toEqual([]);
  });

  it('detects temperature above max threshold', () => {
    const anomalies = evaluateTelemetry({ ...basePayload, temperature: 11 }, { maxTemp: 10 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      shipmentId: basePayload.shipmentId,
      type: 'TEMPERATURE_EXCEEDED',
      severity: 'HIGH',
      resolved: false,
    });
  });

  it('detects temperature below min threshold', () => {
    const anomalies = evaluateTelemetry({ ...basePayload, temperature: 9 }, { minTemp: 10 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      shipmentId: basePayload.shipmentId,
      type: 'TEMPERATURE_BELOW_MIN',
      severity: 'HIGH',
      resolved: false,
    });
  });

  it('detects humidity above max threshold', () => {
    const anomalies = evaluateTelemetry({ ...basePayload, humidity: 61 }, { maxHumidity: 60 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      shipmentId: basePayload.shipmentId,
      type: 'HUMIDITY_EXCEEDED',
      severity: 'HIGH',
      resolved: false,
    });
  });

  it('detects humidity below min threshold', () => {
    const anomalies = evaluateTelemetry({ ...basePayload, humidity: 59 }, { minHumidity: 60 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      shipmentId: basePayload.shipmentId,
      type: 'HUMIDITY_BELOW_MIN',
      severity: 'HIGH',
      resolved: false,
    });
  });

  it('detects battery below threshold with deterministic severity', () => {
    const anomalies = evaluateTelemetry({ ...basePayload, batteryLevel: 9 }, { minBatteryLevel: 20 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      shipmentId: basePayload.shipmentId,
      type: 'BATTERY_LOW',
      resolved: false,
    });
    expect(['MEDIUM', 'HIGH']).toContain(anomalies[0].severity);
  });

  it('can identify multiple anomalies in a single payload', () => {
    const anomalies = evaluateTelemetry(
      { ...basePayload, temperature: 40, humidity: 99, batteryLevel: 1 },
      { maxTemp: 10, maxHumidity: 60, minBatteryLevel: 20 },
    );
    const types = anomalies.map(a => a.type).sort();
    expect(types).toEqual(['BATTERY_LOW', 'HUMIDITY_EXCEEDED', 'TEMPERATURE_EXCEEDED'].sort());
  });

  it('ignores non-finite numeric inputs', () => {
    const anomalies = evaluateTelemetry(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...basePayload, temperature: Number.NaN as any, humidity: Infinity as any, batteryLevel: null },
      { maxTemp: 10, maxHumidity: 60, minBatteryLevel: 20 },
    );
    expect(anomalies).toEqual([]);
  });
});

