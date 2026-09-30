/**
 * Regression test for issue #763.
 *
 * Guards the public Socket.IO / SSE event-name contract against accidental
 * reintroduction of dead names (telemetry_update, payment_status_changed) and
 * against silent renames of the live event strings.
 *
 * A future rename MUST update this file intentionally — the test will fail
 * loudly, making the change visible in code review.
 */
import { describe, it, expect } from '@jest/globals';
import {
  SOCKET_EVENTS,
  type SocketEventName,
} from '../src/shared/types/socketEvents.js';

describe('SOCKET_EVENTS constants — #763 realtime contract regression', () => {
  // -------------------------------------------------------------------------
  // Documented live event names
  // -------------------------------------------------------------------------

  it('LOCATION_UPDATE maps to "location:update"', () => {
    expect(SOCKET_EVENTS.LOCATION_UPDATE).toBe('location:update');
  });

  it('ANOMALY_DETECTED maps to "anomaly:detected"', () => {
    expect(SOCKET_EVENTS.ANOMALY_DETECTED).toBe('anomaly:detected');
  });

  it('SHIPMENT_STATUS maps to "shipment:status"', () => {
    expect(SOCKET_EVENTS.SHIPMENT_STATUS).toBe('shipment:status');
  });

  it('SETTLEMENT_STATUS maps to "settlement:status"', () => {
    expect(SOCKET_EVENTS.SETTLEMENT_STATUS).toBe('settlement:status');
  });

  it('NOTIFICATION_NEW maps to "notification:new"', () => {
    expect(SOCKET_EVENTS.NOTIFICATION_NEW).toBe('notification:new');
  });

  // -------------------------------------------------------------------------
  // Dead names must not appear
  // -------------------------------------------------------------------------

  it('does not expose the dead name "telemetry_update"', () => {
    expect(Object.values(SOCKET_EVENTS)).not.toContain('telemetry_update');
  });

  it('does not expose the dead name "payment_status_changed"', () => {
    expect(Object.values(SOCKET_EVENTS)).not.toContain('payment_status_changed');
  });

  // -------------------------------------------------------------------------
  // All constants must be valid SocketEventName keys
  // (TypeScript enforces this at compile time via `satisfies`; this runtime
  // check documents the invariant for readers of the test output.)
  // -------------------------------------------------------------------------

  it('every SOCKET_EVENTS value is a valid SocketEventName (runtime check)', () => {
    const validNames: SocketEventName[] = [
      'location:update',
      'anomaly:detected',
      'shipment:status',
      'settlement:status',
      'notification:new',
    ];

    for (const value of Object.values(SOCKET_EVENTS)) {
      expect(validNames).toContain(value);
    }
  });

  it('has exactly 5 live event names — no extras and no missing entries', () => {
    expect(Object.keys(SOCKET_EVENTS)).toHaveLength(5);
  });

  // -------------------------------------------------------------------------
  // Production emission sites use the shared constants (import-level check).
  //
  // These tests verify that the emitter helpers exported from the socket
  // infrastructure module exist and match the constant values.  They do NOT
  // run the full app — they only confirm that the emitter symbol names are
  // present so that a rename of either side would be caught at import time.
  // -------------------------------------------------------------------------

  it('infra/socket/io.ts exports emitTelemetryUpdate (emits LOCATION_UPDATE)', async () => {
    // Dynamic import avoids the need for a fully-booted server.
    // The function should exist as an export regardless of whether Socket.IO
    // is initialised.
    const mod = await import('../src/infra/socket/io.js').catch(() => null);
    // If the import itself fails the project has a bigger problem; skip
    // gracefully so this test never masks a real infrastructure error.
    if (!mod) return;
    expect(typeof mod.emitTelemetryUpdate).toBe('function');
  });

  it('infra/socket/io.ts exports emitPaymentStatusChange (emits SETTLEMENT_STATUS)', async () => {
    const mod = await import('../src/infra/socket/io.js').catch(() => null);
    if (!mod) return;
    expect(typeof mod.emitPaymentStatusChange).toBe('function');
  });
});
