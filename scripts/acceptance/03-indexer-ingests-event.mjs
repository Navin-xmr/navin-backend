#!/usr/bin/env node
/* eslint-env node */
/** Scenario 3: indexer ingests emitted event. Usage: INDEXER_EVENT_ID=<chain event id> node scripts/acceptance/03-indexer-ingests-event.mjs */
import { api, assert, run } from './scenario.mjs';

const eventId = process.env.INDEXER_EVENT_ID;
await run('indexer ingests emitted event', async () => {
  assert(eventId, 'INDEXER_EVENT_ID must be set (id of an emitted chain event)');
  const blocks = await api('/ledger/blocks?limit=50');
  assert(blocks.ok, `ledger query failed (HTTP ${blocks.status})`);
  const items = Array.isArray(blocks.data) ? blocks.data : (blocks.data?.blocks ?? []);
  assert(
    items.some(block => JSON.stringify(block).includes(eventId)),
    `chain event ${eventId} was not ingested into the ledger`
  );
});
