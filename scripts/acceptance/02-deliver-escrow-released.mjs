#!/usr/bin/env node
/* eslint-env node */
/** Scenario 2: deliver -> escrow released. Usage: DELIVERY_SHIPMENT_ID=<id> node scripts/acceptance/02-deliver-escrow-released.mjs */
import { api, assert, findEvent, run } from './scenario.mjs';

const id = process.env.DELIVERY_SHIPMENT_ID;
await run('deliver -> escrow released', async () => {
  assert(id, 'DELIVERY_SHIPMENT_ID must be set');
  const delivered = await api(`/shipments/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DELIVERED', note: 'acceptance delivery' }),
  });
  assert(delivered.ok, `delivery status update failed (HTTP ${delivered.status})`);
  const blocks = await api('/ledger/blocks?limit=20');
  assert(blocks.ok, `ledger query failed (HTTP ${blocks.status})`);
  assert(
    findEvent(blocks.data, ['esc_rel', 'escrow_release', 'ESCROW_RELEASE']),
    'no escrow release event found after delivery'
  );
});
