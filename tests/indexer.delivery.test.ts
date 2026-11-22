import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';
import { Address, Keypair, nativeToScVal } from '@stellar/stellar-sdk';

import { indexStellarTransactions } from '../src/workers/stellar-indexer.worker.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import {
  chainSecondsToDate,
  classifyDelivery,
  recordDeliveryEvent,
} from '../src/modules/shipments/shipmentDelivery.service.js';
import {
  DeliveryClassification,
  ShipmentDelivery,
} from '../src/modules/shipments/shipmentDelivery.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { CHAIN_EVENT_NAMES, ChainEventSchema, parseChainEvent } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import fixtures from './fixtures/chain/events.json' with { type: 'json' };

const SUCCESS = parseChainEvent(fixtures.events.delivery_success);
const CONFIRMED = parseChainEvent(fixtures.events.delivery_confirmed);
if (
  SUCCESS.name !== CHAIN_EVENT_NAMES.DELIVERY_SUCCESS ||
  CONFIRMED.name !== CHAIN_EVENT_NAMES.DELIVERY_CONFIRMED
) {
  throw new Error('fixture mismatch');
}
const DELIVERY_SEC = Number(SUCCESS.data[3]); // 2026-09-27T10:30:00Z, from the CHAIN event
const CHAIN_ID = SUCCESS.data[0];
const CARRIER = SUCCESS.data[4];
const RECEIVER = CONFIRMED.data[4];

const at = (sec: number) => new Date(sec * 1000);

async function makeShipment(expectedDelivery?: Date, chainShipmentId = CHAIN_ID) {
  return Shipment.create({
    trackingNumber: `TRK-${new Types.ObjectId().toString().slice(-8)}`,
    origin: 'Lagos',
    destination: 'Abuja',
    enterpriseId: new Types.ObjectId(),
    logisticsId: new Types.ObjectId(),
    chainShipmentId,
    ...(expectedDelivery && { expectedDelivery }),
  });
}

function withId<T extends ChainEvent>(event: T, id: string): T {
  return { ...event, id };
}

beforeEach(async () => {
  await ShipmentDelivery.deleteMany({});
  await Shipment.deleteMany({});
});

describe('delivery event schemas (#1043)', () => {
  it('decodes both topics per the real contract tuple layout', () => {
    expect(SUCCESS.topic).toEqual(['delivery_success']);
    expect(CONFIRMED.topic).toEqual(['delivery_confirmed']);
    for (const e of [SUCCESS, CONFIRMED]) {
      expect(e.data).toHaveLength(5);
      expect(e.data[1]).toBe('Delivered');
    }
  });

  it.each([
    ['non-numeric shipment id', 0, 'abc'],
    ['bad status', 1, 'InTransit'],
    ['bad hash', 2, 'zz'],
    ['negative delivery_time', 3, '-5'],
    ['u64 overflow delivery_time', 3, '18446744073709551616'],
    ['bad address', 4, 'nope'],
  ])('rejects %s', (_label, index, value) => {
    const data = [...SUCCESS.data] as unknown[];
    data[index] = value;
    expect(ChainEventSchema.safeParse({ ...SUCCESS, data }).success).toBe(false);
  });
});

describe('Soroban ScVal decoding of delivery events (#1043)', () => {
  const hash = Buffer.from(SUCCESS.data[2], 'hex');
  const tuple = (actor: string) =>
    nativeToScVal(
      [
        nativeToScVal(BigInt(CHAIN_ID), { type: 'u64' }),
        nativeToScVal(['Delivered'], { type: ['symbol'] }),
        nativeToScVal(hash, { type: 'bytes' }),
        nativeToScVal(BigInt(DELIVERY_SEC), { type: 'u64' }),
        new Address(actor).toScVal(),
      ],
      { type: ['scvU64', 'scvVec', 'scvBytes', 'scvU64', 'scvAddress'] as never }
    );

  it.each([
    ['delivery_success', CARRIER],
    ['delivery_confirmed', RECEIVER],
  ])('%s round-trips from raw ScVals to the spec event', async (name, actor) => {
    const server = {
      getEvents: async () => ({
        events: [
          {
            id: '0002200479567253507-0000000001',
            contractId: SUCCESS.contract_id,
            txHash: SUCCESS.tx_hash,
            ledger: SUCCESS.ledger,
            ledgerClosedAt: SUCCESS.ledger_closed_at,
            topic: [nativeToScVal(name, { type: 'symbol' })],
            value: tuple(actor),
          },
        ],
      }),
    };
    const adapter = new SorobanAdapter({
      contractId: SUCCESS.contract_id,
      secretKey: Keypair.random().secret(),
      rpcServer: server as never,
    });
    const out: ChainEvent[] = [];
    for await (const ev of adapter.streamEvents()) out.push(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name,
      topic: [name],
      data: [CHAIN_ID, 'Delivered', SUCCESS.data[2], String(DELIVERY_SEC), actor],
    });
  });
});

describe('classifyDelivery — deadline boundary', () => {
  const deadline = at(DELIVERY_SEC);
  it('is ON_TIME strictly before the deadline', () => {
    expect(classifyDelivery(at(DELIVERY_SEC - 1), deadline)).toBe(DeliveryClassification.ON_TIME);
  });
  it('is ON_TIME exactly at the deadline (inclusive boundary)', () => {
    expect(classifyDelivery(at(DELIVERY_SEC), deadline)).toBe(DeliveryClassification.ON_TIME);
  });
  it('is LATE one second after the deadline', () => {
    expect(classifyDelivery(at(DELIVERY_SEC + 1), deadline)).toBe(DeliveryClassification.LATE);
  });
  it('is LATE when the deadline has sub-second precision below the delivery second', () => {
    expect(classifyDelivery(at(DELIVERY_SEC), new Date(deadline.getTime() - 500))).toBe(
      DeliveryClassification.LATE
    );
  });
  it('is UNKNOWN without a deadline', () => {
    expect(classifyDelivery(at(DELIVERY_SEC), undefined)).toBe(DeliveryClassification.UNKNOWN);
    expect(classifyDelivery(at(DELIVERY_SEC), new Date('invalid'))).toBe(
      DeliveryClassification.UNKNOWN
    );
  });
});

describe('recordDeliveryEvent (#1043)', () => {
  it('persists the chain delivery_time and carrier — never the server clock', async () => {
    const shipment = await makeShipment(at(DELIVERY_SEC + 3600));
    const before = Date.now();
    expect(await recordDeliveryEvent(SUCCESS)).toBe('created');

    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.deliveryTime).toEqual(chainSecondsToDate(String(DELIVERY_SEC)));
    expect(doc!.deliveryTime.getTime()).toBeLessThan(before); // fixture is in the past
    expect(doc?.carrier).toBe(CARRIER);
    expect(String(doc?.shipmentId)).toBe(String(shipment._id));
    expect(doc?.success).toMatchObject({ eventId: SUCCESS.id, txHash: SUCCESS.tx_hash });
  });

  it('classifies an on-time delivery', async () => {
    await makeShipment(at(DELIVERY_SEC + 60));
    await recordDeliveryEvent(SUCCESS);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.classification).toBe(DeliveryClassification.ON_TIME);
  });

  it('classifies a late delivery', async () => {
    await makeShipment(at(DELIVERY_SEC - 60));
    await recordDeliveryEvent(SUCCESS);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.classification).toBe(DeliveryClassification.LATE);
  });

  it('treats delivery exactly at the deadline as on time', async () => {
    await makeShipment(at(DELIVERY_SEC));
    await recordDeliveryEvent(SUCCESS);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.classification).toBe(DeliveryClassification.ON_TIME);
  });

  it('is UNKNOWN when the on-chain shipment cannot be resolved', async () => {
    await recordDeliveryEvent(SUCCESS);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc).toMatchObject({ classification: DeliveryClassification.UNKNOWN });
    expect(doc?.shipmentId).toBeUndefined();
  });

  it('records delivery_confirmed (receiver) and merges with delivery_success', async () => {
    await makeShipment(at(DELIVERY_SEC + 60));
    expect(await recordDeliveryEvent(SUCCESS)).toBe('created');
    expect(await recordDeliveryEvent(CONFIRMED)).toBe('updated');

    expect(await ShipmentDelivery.countDocuments({ chainShipmentId: CHAIN_ID })).toBe(1);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.carrier).toBe(CARRIER);
    expect(doc?.receiver).toBe(RECEIVER);
    expect(doc?.success?.eventId).toBe(SUCCESS.id);
    expect(doc?.confirmed?.eventId).toBe(CONFIRMED.id);
  });

  it('handles delivery_confirmed arriving before delivery_success; success time wins', async () => {
    await makeShipment(at(DELIVERY_SEC + 60));
    const confirmedEarly = {
      ...CONFIRMED,
      data: [...CONFIRMED.data.slice(0, 3), String(DELIVERY_SEC - 5), CONFIRMED.data[4]],
    } as ChainEvent;
    await recordDeliveryEvent(confirmedEarly);
    let doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.deliveryTime).toEqual(at(DELIVERY_SEC - 5));
    expect(doc?.carrier).toBeUndefined();

    await recordDeliveryEvent(SUCCESS);
    doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.deliveryTime).toEqual(at(DELIVERY_SEC));
    expect(doc?.carrier).toBe(CARRIER);
    // Classification froze on first computation (on time) and is not flipped by reordering.
    expect(doc?.classification).toBe(DeliveryClassification.ON_TIME);
  });

  it('ignores a duplicate event (same id) and replay does not change anything', async () => {
    await makeShipment(at(DELIVERY_SEC - 1));
    await recordDeliveryEvent(SUCCESS);
    const first = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();

    expect(await recordDeliveryEvent(SUCCESS)).toBe('duplicate');
    expect(await recordDeliveryEvent(SUCCESS)).toBe('duplicate');

    expect(await ShipmentDelivery.countDocuments({})).toBe(1);
    const again = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(again).toEqual(first);
  });

  it('ignores a re-emitted topic with a different event id', async () => {
    await makeShipment(at(DELIVERY_SEC + 60));
    await recordDeliveryEvent(SUCCESS);
    const reEmitted = withId(SUCCESS, 'other-event-id');
    expect(await recordDeliveryEvent(reEmitted)).toBe('duplicate');
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.success?.eventId).toBe(SUCCESS.id);
  });

  it('does not reclassify once classified, even if the deadline later changes', async () => {
    const shipment = await makeShipment(at(DELIVERY_SEC + 60));
    await recordDeliveryEvent(SUCCESS);
    await Shipment.updateOne({ _id: shipment._id }, { expectedDelivery: at(DELIVERY_SEC - 999) });
    await recordDeliveryEvent(CONFIRMED);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.classification).toBe(DeliveryClassification.ON_TIME);
  });

  it('classifies later when an UNKNOWN delivery gains a resolvable shipment', async () => {
    await recordDeliveryEvent(SUCCESS);
    await makeShipment(at(DELIVERY_SEC - 10));
    await recordDeliveryEvent(CONFIRMED);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.classification).toBe(DeliveryClassification.LATE);
  });
});

describe('indexStellarTransactions — delivery events (#1043)', () => {
  const events: ChainEvent[] = [SUCCESS, CONFIRMED];
  const adapter: ChainAdapter = {
    anchorEvent: jest.fn<ChainAdapter['anchorEvent']>(),
    releaseEscrow: jest.fn<ChainAdapter['releaseEscrow']>(),
    async *streamEvents() {
      yield* events;
    },
    getConfirmationCount: async () => 3,
  };

  afterEach(() => jest.clearAllMocks());

  it('indexes both topics into one record and is idempotent across runs', async () => {
    await makeShipment(at(DELIVERY_SEC + 60));

    const first = await indexStellarTransactions(adapter, '');
    expect(first).toMatchObject({ processed: 2, upserted: 2, lastCursor: CONFIRMED.id });

    const second = await indexStellarTransactions(adapter, '', { persistCursor: false });
    expect(second).toMatchObject({ processed: 2, upserted: 0 });

    expect(await ShipmentDelivery.countDocuments({})).toBe(1);
    const doc = await ShipmentDelivery.findOne({ chainShipmentId: CHAIN_ID }).lean();
    expect(doc?.classification).toBe(DeliveryClassification.ON_TIME);
  });

  it('dry-run reports without writing', async () => {
    const summary = await indexStellarTransactions(adapter, '', { dryRun: true });
    expect(summary).toMatchObject({ processed: 2, upserted: 2, existing: 0 });
    expect(await ShipmentDelivery.countDocuments({})).toBe(0);
  });
});
