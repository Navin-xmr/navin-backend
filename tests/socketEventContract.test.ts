/**
 * Realtime event contract — #759 / #760.
 *
 * Two guarantees:
 *  1. `SOCKET_EVENTS` in `src/shared/types/socketEvents.ts` is the single source
 *     of truth: the constants, `SocketEventMap` and the real emitters in
 *     `src/infra/socket/io.ts` cannot disagree.
 *  2. No active test asserts a retired event-name literal, so the namespaced
 *     protocol cannot silently regress.
 */
import { describe, expect, afterAll, beforeAll, it, jest } from '@jest/globals';
import { createServer, type Server as HttpServer } from 'http';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { SOCKET_EVENTS, RETIRED_SOCKET_EVENT_NAMES } from '../src/shared/types/socketEvents.js';
import type {
  AnomalyAlertPayload,
  NotificationPayload,
  SettlementStatusPayload,
  SocketEventName,
  StatusUpdatePayload,
  TelemetryUpdatePayload,
} from '../src/shared/types/socketEvents.js';
import { expectTelemetryPayload, expectSettlementPayload } from './helpers/socketContract.js';

// The SSE fan-out that every emitter triggers resolves against these models.
// Stubbing them keeps the suite hermetic and free of database round-trips.
await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findById: jest.fn(() => ({
      select: jest.fn(() => ({ lean: jest.fn(() => Promise.resolve(null)) })),
    })),
  },
  ShipmentStatus: {},
}));

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    find: jest.fn(() => ({
      select: jest.fn(() => ({ lean: jest.fn(() => Promise.resolve([])) })),
    })),
  },
  OrganizationModel: jest.fn(),
  UserRole: {},
  OrganizationType: {},
}));

const SHIPMENT_ID = '6710000000000000000000aa';
const ROOM = `shipment_${SHIPMENT_ID}`;

const telemetryPayload: TelemetryUpdatePayload = {
  telemetryId: 'telemetry-1',
  shipmentId: SHIPMENT_ID,
  sensorId: 'sensor-1',
  temperature: 4.5,
  humidity: 61,
  latitude: 51.5,
  longitude: -0.12,
  batteryLevel: 87,
  timestamp: '2026-02-01T08:00:00.000Z',
  dataHash: 'hash-1',
  anchorStatus: 'PENDING_ANCHOR',
};

const settlementPayload: SettlementStatusPayload = {
  paymentId: 'pay-1',
  shipmentId: SHIPMENT_ID,
  oldStatus: 'ESCROWED',
  newStatus: 'RELEASED',
  amount: 120.5,
  txHash: 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66',
  timestamp: '2026-02-01T08:05:00.000Z',
};

const anomalyPayload: AnomalyAlertPayload = {
  anomalyId: 'anomaly-1',
  shipmentId: SHIPMENT_ID,
  type: 'TEMPERATURE_EXCEEDED',
  severity: 'HIGH',
  message: 'out of range',
  timestamp: '2026-02-01T08:10:00.000Z',
  resolved: false,
};

const statusPayload: StatusUpdatePayload = { shipmentId: SHIPMENT_ID, status: 'IN_TRANSIT' };

const notificationPayload: NotificationPayload = {
  notificationId: 'notification-1',
  recipientId: 'user-1',
  type: 'SYSTEM',
  title: 'Hi',
  body: 'There',
  timestamp: '2026-02-01T08:15:00.000Z',
  read: false,
};

const LIVE_EVENT_NAMES: readonly SocketEventName[] = [
  'location:update',
  'anomaly:detected',
  'shipment:status',
  'settlement:status',
  'notification:new',
];

describe('realtime event name constants are the single source of truth', () => {
  it('covers every event declared in SocketEventMap, and nothing else', () => {
    expect(Object.values(SOCKET_EVENTS).sort()).toEqual([...LIVE_EVENT_NAMES].sort());
  });

  it('does not reuse a retired event name for any constant', () => {
    for (const name of Object.values(SOCKET_EVENTS)) {
      expect(RETIRED_SOCKET_EVENT_NAMES).not.toContain(name);
    }
  });

  it('ships a non-empty list of retired names for the audit suite', () => {
    expect(RETIRED_SOCKET_EVENT_NAMES.length).toBeGreaterThan(0);
  });
});

describe('src/infra/socket/io.ts emitters broadcast the live event names', () => {
  let httpServer: HttpServer;
  let closeSocketIO: () => Promise<void>;
  let emitAnomalyDetected: (shipmentId: string, payload: AnomalyAlertPayload) => void;
  let emitTelemetryUpdate: (shipmentId: string, payload: TelemetryUpdatePayload) => void;
  let emitStatusUpdate: (shipmentId: string, payload: StatusUpdatePayload) => void;
  let emitPaymentStatusChange: (shipmentId: string, payload: SettlementStatusPayload) => void;
  let emitNotificationNew: (recipientId: string, payload: NotificationPayload) => void;
  let broadcastTo: jest.Mock<() => { emit: jest.Mock }>;
  let broadcast: jest.Mock;

  beforeAll(async () => {
    httpServer = createServer();
    const ioModule = await import('../src/infra/socket/io.js');
    const server = ioModule.initSocketIO(httpServer);

    closeSocketIO = ioModule.closeSocketIO;
    emitAnomalyDetected = ioModule.emitAnomalyDetected;
    emitTelemetryUpdate = ioModule.emitTelemetryUpdate;
    emitStatusUpdate = ioModule.emitStatusUpdate;
    emitPaymentStatusChange = ioModule.emitPaymentStatusChange;
    emitNotificationNew = ioModule.emitNotificationNew;

    broadcast = jest.fn();
    broadcastTo = jest.fn<() => { emit: jest.Mock }>(() => ({ emit: broadcast }));
    jest.spyOn(server, 'to').mockImplementation(broadcastTo as never);
  });

  afterAll(async () => {
    await closeSocketIO();
    await new Promise<void>(done => httpServer.close(() => done()));
  });

  it('emits location:update to the shipment room for telemetry', () => {
    emitTelemetryUpdate(SHIPMENT_ID, telemetryPayload);

    expect(broadcastTo).toHaveBeenCalledWith(ROOM);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(SOCKET_EVENTS.TELEMETRY_UPDATE, telemetryPayload);
    expect(expectTelemetryPayload(broadcast.mock.calls[0][1])).toEqual(telemetryPayload);
  });

  it('emits settlement:status with txHash to the shipment room', () => {
    emitPaymentStatusChange(SHIPMENT_ID, settlementPayload);

    expect(broadcastTo).toHaveBeenCalledWith(ROOM);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(SOCKET_EVENTS.SETTLEMENT_STATUS, settlementPayload);
    expect(expectSettlementPayload(broadcast.mock.calls[0][1]).txHash).toBe(
      settlementPayload.txHash
    );
  });

  it('emits anomaly:detected to the shipment room', () => {
    emitAnomalyDetected(SHIPMENT_ID, anomalyPayload);

    expect(broadcastTo).toHaveBeenCalledWith(ROOM);
    expect(broadcast).toHaveBeenCalledWith(SOCKET_EVENTS.ANOMALY_DETECTED, anomalyPayload);
  });

  it('emits shipment:status to the shipment room', () => {
    emitStatusUpdate(SHIPMENT_ID, statusPayload);

    expect(broadcastTo).toHaveBeenCalledWith(ROOM);
    expect(broadcast).toHaveBeenCalledWith(SOCKET_EVENTS.SHIPMENT_STATUS, statusPayload);
  });

  it('emits notification:new to a user-scoped room', () => {
    emitNotificationNew('user-1', notificationPayload);

    expect(broadcastTo).toHaveBeenCalledWith('user-1');
    expect(broadcast).toHaveBeenCalledWith(SOCKET_EVENTS.NOTIFICATION_NEW, notificationPayload);
  });
});

function listTestFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTestFiles(full));
    } else if (full.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('retired event-name literals (#760)', () => {
  /**
   * Files allowed to reference a retired literal on purpose — for example a
   * documented backward-compatibility suite. Empty today.
   */
  const INTENTIONAL: readonly string[] = [];

  const roots = [resolve(process.cwd(), 'tests'), resolve(process.cwd(), 'src')];

  it('are absent from every active test suite', () => {
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of listTestFiles(root)) {
        const rel = relative(process.cwd(), file).split(sep).join('/');
        if (INTENTIONAL.includes(rel)) continue;

        const source = readFileSync(file, 'utf8');
        for (const legacy of RETIRED_SOCKET_EVENT_NAMES) {
          if (source.includes(legacy))
            offenders.push(`${rel} still references a retired event name`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
