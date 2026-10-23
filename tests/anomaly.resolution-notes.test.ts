import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { redisMock } from './fixtures/factories.js';

/** @see issue-#288 */

const redisStore = new Map<string, string>();
await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
// ─── Issue #288 — Anomaly resolution notes ───────────────────────────────────

describe('#288 resolveAnomalyService — resolution notes', () => {
  const mockAnomaly = {
    _id: 'anom-1',
    shipmentId: 'ship-1',
    type: 'TEMPERATURE_EXCEEDED',
    severity: 'HIGH',
    message: 'Too hot',
    resolved: true,
    resolvedAt: new Date(),
    resolvedBy: 'user-42',
    resolutionNote: 'False alarm',
  };

  const findByIdAndUpdate = jest.fn(() => ({ lean: jest.fn(async () => mockAnomaly) }));

  beforeEach(async () => {
    jest.resetModules();
    findByIdAndUpdate.mockClear();
    await jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(redisStore));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
      Anomaly: { findByIdAndUpdate },
    }));
  });

  it('sets resolved, resolvedAt, resolvedBy and resolutionNote', async () => {
    const { resolveAnomalyService } = await import('../src/modules/anomaly/anomaly.service.js');
    const result = await resolveAnomalyService('anom-1', 'user-42', 'False alarm');
    const [, update] = findByIdAndUpdate.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(update.resolved).toBe(true);
    expect(update.resolvedBy).toBe('user-42');
    expect(update.resolutionNote).toBe('False alarm');
    expect(update.resolvedAt).toBeInstanceOf(Date);
    expect(result).toEqual(mockAnomaly);
  });

  it('works without a note (backward-compatible)', async () => {
    const { resolveAnomalyService } = await import('../src/modules/anomaly/anomaly.service.js');
    await resolveAnomalyService('anom-1', 'user-42');
    const [, update] = findByIdAndUpdate.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(update.resolutionNote).toBeUndefined();
    expect(update.resolvedBy).toBe('user-42');
  });

  it('throws when anomaly not found', async () => {
    findByIdAndUpdate.mockReturnValueOnce({ lean: jest.fn(async () => null) } as any);
    const { resolveAnomalyService } = await import('../src/modules/anomaly/anomaly.service.js');
    await expect(resolveAnomalyService('bad-id', 'user-1')).rejects.toThrow('Anomaly not found');
  });
});
