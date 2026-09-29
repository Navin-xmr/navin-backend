/**
 * Shared helpers for asserting the real-time event contract.
 *
 * Issue #759/#760/#761/#762: tests must assert the *live* emitted event and
 * payload, not merely that an emitter function was called. These helpers keep
 * the socket.io mock export surface aligned with `src/infra/socket/io.ts` and
 * provide runtime payload checks that fail when a required field is dropped or
 * renamed.
 */
import { expect, jest } from '@jest/globals';
import { SOCKET_EVENTS } from '../../src/shared/types/socketEvents.js';
import type {
  SettlementStatusPayload,
  TelemetryUpdatePayload,
} from '../../src/shared/types/socketEvents.js';

export type TelemetryEmitter = (shipmentId: string, payload: TelemetryUpdatePayload) => void;
export type SettlementEmitter = (shipmentId: string, payload: SettlementStatusPayload) => void;
export type AnomalyEmitter = (shipmentId: string, payload: unknown) => void;
export type StatusEmitter = (shipmentId: string, payload: unknown) => void;
export type NotificationEmitter = (recipientId: string, payload: unknown) => void;

/** Jest mock matching the full production signature of `emitTelemetryUpdate`. */
export function telemetryEmitterMock() {
  return jest.fn<TelemetryEmitter>();
}

/** Jest mock matching the full production signature of `emitPaymentStatusChange`. */
export function settlementEmitterMock() {
  return jest.fn<SettlementEmitter>();
}

/**
 * Complete `io.js` mock factory.
 *
 * `jest.unstable_mockModule` links the module graph eagerly: omitting a named
 * export that any transitively imported module uses makes the whole suite fail
 * with `SyntaxError: ... does not provide an export named '...'`. Every
 * emitter exported by `src/infra/socket/io.ts` must therefore be listed here.
 */
export function socketIoMock(
  overrides: {
    emitTelemetryUpdate?: TelemetryEmitter;
    emitPaymentStatusChange?: SettlementEmitter;
    emitAnomalyDetected?: AnomalyEmitter;
    emitStatusUpdate?: StatusEmitter;
    emitNotificationNew?: NotificationEmitter;
  } = {}
) {
  return {
    initSocketIO: jest.fn(),
    getIO: jest.fn(),
    closeSocketIO: jest.fn(async () => undefined),
    getActiveUsers: jest.fn(() => new Map<string, string>()),
    emitTelemetryUpdate: overrides.emitTelemetryUpdate ?? jest.fn<TelemetryEmitter>(),
    emitPaymentStatusChange: overrides.emitPaymentStatusChange ?? jest.fn<SettlementEmitter>(),
    emitAnomalyDetected: overrides.emitAnomalyDetected ?? jest.fn<AnomalyEmitter>(),
    emitStatusUpdate: overrides.emitStatusUpdate ?? jest.fn<StatusEmitter>(),
    emitNotificationNew: overrides.emitNotificationNew ?? jest.fn<NotificationEmitter>(),
  };
}

const ANCHOR_STATUSES = new Set(['PENDING_ANCHOR', 'ANCHORED', 'ANCHOR_FAILED']);

/**
 * Runtime check that `value` carries every required `TelemetryUpdatePayload`
 * field with the right type. Throws nothing — returns a list of problems so
 * property-based suites can fold it into a boolean, and example-based suites
 * can assert `toEqual([])`.
 */
export function telemetryPayloadProblems(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['payload is not an object'];
  const p = value as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of ['telemetryId', 'shipmentId', 'sensorId', 'timestamp', 'dataHash'] as const) {
    if (typeof p[key] !== 'string' || p[key] === '')
      problems.push(`${key} must be a non-empty string`);
  }
  for (const key of ['temperature', 'humidity', 'latitude', 'longitude', 'batteryLevel'] as const) {
    if (typeof p[key] !== 'number' || Number.isNaN(p[key] as number)) {
      problems.push(`${key} must be a number`);
    }
  }
  if (typeof p['anchorStatus'] !== 'string' || !ANCHOR_STATUSES.has(p['anchorStatus'] as string)) {
    problems.push('anchorStatus must be PENDING_ANCHOR | ANCHORED | ANCHOR_FAILED');
  }
  if (p['stellarTxHash'] !== undefined && typeof p['stellarTxHash'] !== 'string') {
    problems.push('stellarTxHash must be a string when present');
  }

  return problems;
}

/** Asserts `value` is a complete `TelemetryUpdatePayload` and narrows its type. */
export function expectTelemetryPayload(value: unknown): TelemetryUpdatePayload {
  expect(telemetryPayloadProblems(value)).toEqual([]);
  return value as TelemetryUpdatePayload;
}

/**
 * Asserts `value` is a complete `SettlementStatusPayload` and narrows its type.
 * `txHash` is optional by contract but, when supplied, must survive unchanged —
 * this is what makes the suite fail if tx-hash propagation is lost.
 */
export function expectSettlementPayload(value: unknown): SettlementStatusPayload {
  expect(value).toEqual(
    expect.objectContaining({
      paymentId: expect.any(String),
      shipmentId: expect.any(String),
      oldStatus: expect.any(String),
      newStatus: expect.any(String),
      amount: expect.any(Number),
      timestamp: expect.any(String),
    })
  );
  return value as SettlementStatusPayload;
}

/** The canonical telemetry event name consumers must subscribe to. */
export const TELEMETRY_EVENT = SOCKET_EVENTS.TELEMETRY_UPDATE;
/** The canonical settlement event name consumers must subscribe to. */
export const SETTLEMENT_EVENT = SOCKET_EVENTS.SETTLEMENT_STATUS;
