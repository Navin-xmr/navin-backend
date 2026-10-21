import { describe, expect, it } from '@jest/globals';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';

/** @see docs/telemetry-pipeline.md */
/**
 * Schema-inspection tests for TelemetrySchema indexes.
 * Validates Requirements 1.1, 1.2, 1.3, 1.4.
 */
describe('TelemetrySchema index definitions', () => {
  it('retains the existing { shipmentId: 1, timestamp: -1 } index (Requirement 1.2)', () => {
    const indexes = Telemetry.schema.indexes();
    const fieldSpecs = indexes.map(([fields]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ shipmentId: 1, timestamp: -1 }])
    );
  });

  it('defines the new { sensorId: 1, shipmentId: 1, timestamp: -1 } composite index (Requirement 1.1)', () => {
    const indexes = Telemetry.schema.indexes();
    const fieldSpecs = indexes.map(([fields]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ sensorId: 1, shipmentId: 1, timestamp: -1 }]),
    );
  });
});
