import { describe, expect, beforeEach, beforeAll, it, afterAll } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Telemetry } from '../src/modules/telemetry/telemetry.model.js';
import {
  confirmAnchoredTelemetry,
  ledgerDepth,
  MIN_CONFIRMATION_LEDGERS,
  type LedgerLookup,
} from '../src/modules/telemetry/telemetry.confirmation.js';
import { TelemetryAnchorStatus } from '../src/shared/types/telemetry.js';

const SHIPMENT_ID = '507f1f77bcf86cd799439011';

async function seed(stellarTxHash: string, anchorStatus = TelemetryAnchorStatus.ANCHORED) {
  return Telemetry.create({
    sensorId: 'sensor-1',
    shipmentId: SHIPMENT_ID,
    temperature: 22.5,
    humidity: 55,
    latitude: 12.34,
    longitude: 56.78,
    batteryLevel: 91,
    timestamp: new Date(),
    dataHash: 'a'.repeat(64),
    rawPayload: { ok: true },
    stellarTxHash,
    anchorStatus,
  });
}

/** Lookup backed by a fixed map of tx hash -> ledger, with a configurable latest ledger. */
function lookupFrom(latest: number, txLedgers: Record<string, number | null | Error>): LedgerLookup {
  return {
    getLatestLedger: async () => latest,
    getTransactionLedger: async hash => {
      const v = txLedgers[hash];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
  };
}

describe('ledgerDepth', () => {
  it('counts the transaction ledger itself', () => {
    expect(ledgerDepth(102, 100)).toBe(3);
    expect(ledgerDepth(100, 100)).toBe(1);
  });

  it('returns 0 when the transaction is ahead of the latest ledger', () => {
    expect(ledgerDepth(99, 100)).toBe(0);
  });

  it('uses 3 ledgers as the default minimum', () => {
    expect(MIN_CONFIRMATION_LEDGERS).toBe(3);
  });
});

describe('confirmAnchoredTelemetry (#818)', () => {
  let mongoServer: MongoMemoryServer | undefined;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 120_000);

  beforeEach(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(mongoServer!.getUri());
    }
    await Telemetry.deleteMany({});
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('flips anchorStatus to VERIFIED and sets verified: true at depth >= 3', async () => {
    const doc = await seed('tx-ok');

    const summary = await confirmAnchoredTelemetry(lookupFrom(102, { 'tx-ok': 100 }));

    const updated = await Telemetry.findById(doc._id).lean();
    expect(updated!.anchorStatus).toBe(TelemetryAnchorStatus.VERIFIED);
    expect(updated!.verified).toBe(true);
    expect(updated!.confirmationMetadata).toMatchObject({ ledger: 100, confirmations: 3, verified: true });
    expect(summary).toEqual({ checked: 1, verified: 1, pending: 0, errors: 0 });
  });

  it('leaves records below the depth threshold as ANCHORED', async () => {
    const doc = await seed('tx-shallow');

    const summary = await confirmAnchoredTelemetry(lookupFrom(101, { 'tx-shallow': 100 }));

    const updated = await Telemetry.findById(doc._id).lean();
    expect(updated!.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
    expect(updated!.verified).toBe(false);
    expect(summary).toEqual({ checked: 1, verified: 0, pending: 1, errors: 0 });
  });

  it('keeps records as ANCHORED when the transaction is not found', async () => {
    const doc = await seed('tx-missing');

    const summary = await confirmAnchoredTelemetry(lookupFrom(500, { 'tx-missing': null }));

    const updated = await Telemetry.findById(doc._id).lean();
    expect(updated!.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
    expect(summary.pending).toBe(1);
  });

  it('isolates per-record lookup failures so the rest of the batch is still verified', async () => {
    const bad = await seed('tx-bad');
    const good = await seed('tx-good');

    const summary = await confirmAnchoredTelemetry(
      lookupFrom(200, { 'tx-bad': new Error('rpc timeout'), 'tx-good': 150 })
    );

    expect((await Telemetry.findById(bad._id).lean())!.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
    expect((await Telemetry.findById(good._id).lean())!.anchorStatus).toBe(TelemetryAnchorStatus.VERIFIED);
    expect(summary).toEqual({ checked: 2, verified: 1, pending: 0, errors: 1 });
  });

  it('is idempotent: a second run does not re-verify or change VERIFIED records', async () => {
    const doc = await seed('tx-repeat');
    const lookup = lookupFrom(110, { 'tx-repeat': 100 });

    await confirmAnchoredTelemetry(lookup);
    const second = await confirmAnchoredTelemetry(lookup);

    expect(second.checked).toBe(0);
    expect(second.verified).toBe(0);
    expect((await Telemetry.findById(doc._id).lean())!.anchorStatus).toBe(TelemetryAnchorStatus.VERIFIED);
  });

  it('ignores records that are not ANCHORED or have no tx hash', async () => {
    const pending = await seed('tx-pending', TelemetryAnchorStatus.PENDING_ANCHOR);
    await Telemetry.create({
      sensorId: 'sensor-2',
      shipmentId: SHIPMENT_ID,
      temperature: 1,
      humidity: 1,
      latitude: 1,
      longitude: 1,
      batteryLevel: 1,
      timestamp: new Date(),
      dataHash: 'b'.repeat(64),
      rawPayload: {},
      anchorStatus: TelemetryAnchorStatus.ANCHORED,
    });

    const summary = await confirmAnchoredTelemetry(lookupFrom(200, { 'tx-pending': 100 }));

    expect(summary.checked).toBe(0);
    expect((await Telemetry.findById(pending._id).lean())!.anchorStatus).toBe(
      TelemetryAnchorStatus.PENDING_ANCHOR
    );
  });

  it('throws when the latest ledger cannot be read, leaving records unchanged', async () => {
    const doc = await seed('tx-latest-fail');
    const lookup: LedgerLookup = {
      getLatestLedger: async () => {
        throw new Error('rpc down');
      },
      getTransactionLedger: async () => 1,
    };

    await expect(confirmAnchoredTelemetry(lookup)).rejects.toThrow('rpc down');
    expect((await Telemetry.findById(doc._id).lean())!.anchorStatus).toBe(TelemetryAnchorStatus.ANCHORED);
  });
});
