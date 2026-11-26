#!/usr/bin/env node
/* eslint-env node */
/** Scenario 1: scan -> anchored. Usage: SCAN_SHIPMENT_ID=<id> node scripts/acceptance/01-scan-to-anchored.mjs */
import { api, assert, findEvent, run } from './scenario.mjs';

const id = process.env.SCAN_SHIPMENT_ID;
await run('scan -> anchored', async () => {
  assert(id, 'SCAN_SHIPMENT_ID must be set');
  const scan = await api(`/shipments/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'IN_TRANSIT', note: 'acceptance scan' }),
  });
  assert(scan.ok, `scan status update failed (HTTP ${scan.status})`);
  const anchored = await api(`/shipments/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DELIVERED', note: 'acceptance anchor' }),
  });
  assert(anchored.ok, `anchor status update failed (HTTP ${anchored.status})`);
  const blocks = await api('/ledger/blocks?limit=20');
  assert(blocks.ok, `ledger query failed (HTTP ${blocks.status})`);
  assert(findEvent(blocks.data, ['anchor', 'anchor_event', 'ANCHOR']), 'no anchor ledger event found for scanned shipment');
});
