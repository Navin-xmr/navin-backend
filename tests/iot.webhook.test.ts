import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import { generateDataHash } from '../src/shared/utils/crypto.js';

describe('POST /api/webhooks/iot', () => {
  const body = {
    shipmentId: '671000000000000000000001',
    temperature: 22.5,
    humidity: 55,
    latitude: 12.34,
    longitude: 56.78,
    batteryLevel: 91,
    timestamp: '2026-01-15T12:30:00.000Z',
  };

  const parsedBodyForHash = {
    ...body,
    timestamp: new Date(body.timestamp),
  };

  const dataHash = generateDataHash(parsedBodyForHash);

  let app: any;
  const mockAnchorTelemetryHash: any = jest.fn();
  const mockTelemetryCreate: any = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAnchorTelemetryHash.mockResolvedValue({ stellarTxHash: 'mock-tx-hash-telemetry' });

    mockTelemetryCreate.mockResolvedValue({
      _id: 't1',
      shipmentId: body.shipmentId,
      temperature: body.temperature,
      humidity: body.humidity,
      latitude: body.latitude,
      longitude: body.longitude,
      batteryLevel: body.batteryLevel,
      timestamp: parsedBodyForHash.timestamp,
      dataHash,
      stellarTxHash: 'mock-tx-hash-telemetry',
      rawPayload: parsedBodyForHash,
    });

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => {
      return {
        Telemetry: {
          create: mockTelemetryCreate,
        },
      };
    });

    await jest.unstable_mockModule('../src/services/stellar.service.js', () => {
      return {
        tokenizeShipment: jest.fn(async () => ({
          stellarTokenId: 'mock-stellar-token-id',
          stellarTxHash: 'mock-stellar-tx-hash',
        })),
        anchorTelemetryHash: mockAnchorTelemetryHash,
      };
    });

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('hashes payload, anchors hash via Stellar, and saves txHash + dataHash', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .send(body);

    expect(res.status).toBe(201);
    expect(mockAnchorTelemetryHash).toHaveBeenCalledWith({
      shipmentId: body.shipmentId,
      dataHash,
    });

    expect(mockTelemetryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: body.shipmentId,
        temperature: body.temperature,
        humidity: body.humidity,
        latitude: body.latitude,
        longitude: body.longitude,
        batteryLevel: body.batteryLevel,
        timestamp: expect.any(Date),
        dataHash,
        stellarTxHash: 'mock-tx-hash-telemetry',
        rawPayload: expect.objectContaining({
          ...parsedBodyForHash,
          // Ensure we don't accidentally depend on reference equality.
          timestamp: expect.any(Date),
        }),
      }),
    );

    expect(res.body.data).toEqual(
      expect.objectContaining({
        dataHash,
        stellarTxHash: 'mock-tx-hash-telemetry',
      }),
    );
  });

  it('returns 400 on invalid payload (validation error)', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .send({
        ...body,
        temperature: 'not-a-number',
      });

    expect(res.status).toBe(400);
  });
});

