/**
 * P13-08 / #1028 — both race orderings for shipment_created indexing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { parseChainEvent } from '../src/shared/types/chain.js';
import { resolveShipmentCreatedMapping } from '../src/modules/shipments/chainShipmentMapping.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const events = JSON.parse(readFileSync(join(__dirname, 'fixtures/chain/events.json'), 'utf8')) as {
  events: Record<string, unknown>;
};

const event = parseChainEvent(events.events.shipment_created) as Extract<
  ReturnType<typeof parseChainEvent>,
  { name: 'shipment_created' }
>;

describe('P13-08 shipment_created mapping', () => {
  it('maps idempotently when the outbox DB write already landed', () => {
    const mapping = resolveShipmentCreatedMapping(event, { id: '507f1f77bcf86cd799439011' });
    expect(mapping).toMatchObject({
      chainShipmentId: event.topic[1],
      shipmentId: '507f1f77bcf86cd799439011',
      status: 'MAPPED',
      dataHash: event.data[2],
    });
    expect(resolveShipmentCreatedMapping(event, { id: '507f1f77bcf86cd799439011' })).toEqual(
      mapping
    );
  });

  it('quarantines an orphan chain event (DB write has not landed yet)', () => {
    const mapping = resolveShipmentCreatedMapping(event, null);
    expect(mapping.status).toBe('QUARANTINED');
    expect(mapping.shipmentId).toBeNull();
    expect(mapping.dataHash).toBe(event.data[2]);
  });
});
