#!/usr/bin/env node
/* global setTimeout, clearTimeout, fetch */

/**
 * scripts/acceptance/run-soroban.mjs
 *
 * End-to-end Hash-and-Emit acceptance demo (SOROBAN_ADAPTER=soroban).
 *
 * Mirrors scripts/acceptance/run-simulated.mjs, selecting the SorobanAdapter
 * via SOROBAN_ADAPTER=soroban. Requires SOROBAN_RPC_URL + ESCROW_CONTRACT_ID
 * (and a live Soroban RPC) for the actual chain anchor; those steps are
 * best-effort and gracefully skipped when the network is unavailable.
 *
 * Lifecycle:
 *   1. Bootstrap MongoDB + Express app
 *   2. Seed an ADMIN user and sign a JWT
 *   3. POST /api/shipments  -> create shipment
 *   4. PATCH status IN_TRANSIT -> DELIVERED  -> ledger block whose
 *      dataHash = sha256(canonicalPayload) ("anchor milestone")
 *   5. Anchor via ChainAdapter.anchorEvent (soroban port; best effort)
 *   6. Index event via indexStellarTransactions (best effort)
 *   7. GET /api/ledger/blocks/:id/verification -> canonicalPayload + dataHash
 *   8. Recompute sha256(canonicalPayload) and compare to dataHash
 *
 * Exits non-zero if sha256(canonicalPayload) !== dataHash.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { buildApp } from '../../src/app.js';
import { generateDataHash } from '../../src/shared/utils/crypto.js';
import {
  getChainAdapter,
  resetChainAdapter,
  getChainActorAddress,
} from '../../src/services/chain/factory.js';
import { indexStellarTransactions } from '../../src/workers/stellar-indexer.worker.js';
import { OrganizationModel, UserModel } from '../../src/modules/users/users.model.js';
import jwt from 'jsonwebtoken';

const ADAPTER = 'soroban';
const TIMEOUT_MS = 10_000;

let mongoServer;
let httpServer;

function log(...args) {
  console.log(`[acceptance:${ADAPTER}]`, ...args);
}

function fail(message) {
  console.error(`[acceptance:${ADAPTER}] FAIL:`, message);
  process.exitCode = 1;
}

function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function json(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  // Force the adapter this script demonstrates before config is first read.
  process.env.SOROBAN_ADAPTER = ADAPTER;
  resetChainAdapter();

  // The chain adapters sign with STELLAR_SECRET_KEY; synthesize a valid-format
  // key so the anchor step can be attempted (and gracefully skipped offline).
  if (!process.env.STELLAR_SECRET_KEY) {
    const { Keypair } = await import('@stellar/stellar-sdk');
    process.env.STELLAR_SECRET_KEY = Keypair.random().secret();
    log('synthesized STELLAR_SECRET_KEY for adapter demo');
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';
  }

  // ── Step 0: bootstrap MongoDB ────────────────────────────────────────
  log('Step 0: bootstrap MongoDB');
  if (!process.env.MONGO_URI) {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
  }
  await mongoose.connect(process.env.MONGO_URI);

  // ── Step 1: build Express app ────────────────────────────────────────
  log('Step 1: build Express app');
  const app = buildApp();
  httpServer = app.listen(0);
  const port = httpServer.address().port;
  const base = `http://localhost:${port}`;

  // ── Step 2: seed ADMIN user + organization ───────────────────────────
  log('Step 2: seed ADMIN user + organization');
  const org = await OrganizationModel.create({
    name: `Acceptance Org ${ADAPTER}`,
    type: 'ENTERPRISE',
  });
  const orgId = org._id.toString();
  const admin = await UserModel.create({
    email: `acceptance-${ADAPTER}@example.com`,
    name: 'Acceptance Admin',
    passwordHash: 'x',
    role: 'ADMIN',
    organizationId: orgId,
  });
  const token = jwt.sign(
    { userId: admin._id.toString(), role: 'ADMIN', organizationId: orgId },
    process.env.JWT_SECRET
  );
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── Step 3: create shipment ──────────────────────────────────────────
  log('Step 3: POST /api/shipments');
  const createRes = await json(
    await fetch(`${base}/api/shipments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        trackingNumber: `ACCEPT-${ADAPTER}-${Date.now()}`,
        origin: 'Lagos',
        destination: 'Abuja',
        enterpriseId: new mongoose.Types.ObjectId().toString(),
        logisticsId: new mongoose.Types.ObjectId().toString(),
      }),
    })
  );
  if (createRes.status !== 201) {
    fail(`shipment create returned ${createRes.status}`);
    return;
  }
  const shipment = createRes.body.data;
  log(`  created shipment ${shipment._id} (${shipment.trackingNumber})`);

  // ── Step 4: anchor milestone (CREATED -> IN_TRANSIT -> DELIVERED) ────
  // Each transition writes a ledger block whose dataHash = sha256(canonicalPayload).
  log('Step 4: anchor milestone (IN_TRANSIT -> DELIVERED)');
  for (const status of ['IN_TRANSIT', 'DELIVERED']) {
    const res = await json(
      await fetch(`${base}/api/shipments/${shipment._id}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status }),
      })
    );
    if (res.status !== 200) {
      fail(`status transition to ${status} returned ${res.status}`);
      return;
    }
    log(`  -> ${status} (${res.status})`);
  }

  // ── Step 5: anchor via the ChainAdapter port (simulated vs soroban) ──
  log(`Step 5: anchor via ChainAdapter (${ADAPTER})`);
  const adapter = getChainAdapter();
  log(`  adapter: ${adapter.constructor.name}`);
  try {
    const actor = getChainActorAddress();
    const dataHash = generateDataHash({
      actor,
      event: 'DELIVERED',
      metadata: { delivery: true },
      shipmentId: shipment._id.toString(),
      timestamp: new Date().toISOString(),
      v: 1,
    });
    const receipt = await withTimeout(
      adapter.anchorEvent({ shipment_id: shipment.trackingNumber, data_hash: dataHash, actor })
    );
    log(
      `  anchored txHash=${receipt.txHash} ledger=${receipt.ledger} simulated=${receipt.simulated}`
    );
  } catch (err) {
    log(`  anchor skipped (no chain network available): ${err.message}`);
  }

  // ── Step 6: index event ──────────────────────────────────────────────
  log('Step 6: index event (indexStellarTransactions)');
  try {
    const summary = await withTimeout(indexStellarTransactions());
    log(`  processed=${summary.processed} upserted=${summary.upserted}`);
  } catch (err) {
    log(`  index skipped (no chain network available): ${err.message}`);
  }

  // ── Step 7: fetch verification material ──────────────────────────────
  log('Step 7: GET /api/ledger/blocks/:id/verification');
  const blocksRes = await json(
    await fetch(`${base}/api/ledger/blocks?shipmentId=${shipment._id}&limit=5`, {
      headers,
    })
  );
  if (blocksRes.status !== 200 || !Array.isArray(blocksRes.body?.data)) {
    fail(`ledger blocks list returned ${blocksRes.status}`);
    return;
  }
  const blockWithHash = blocksRes.body.data.find(b => b.dataHash);
  if (!blockWithHash) {
    fail('no ledger block with a dataHash was found');
    return;
  }
  const blockId = blockWithHash._id;

  const verificationRes = await json(
    await fetch(`${base}/api/ledger/blocks/${blockId}/verification`, { headers })
  );
  if (verificationRes.status !== 200) {
    fail(`verification endpoint returned ${verificationRes.status}`);
    return;
  }
  const { canonicalPayload, dataHash: claimedHash } = verificationRes.body.data;
  log(`  blockId=${blockId}`);
  log(`  claimed dataHash=${claimedHash}`);

  // ── Step 8: recompute sha256(canonicalPayload) and compare ───────────
  log('Step 8: recompute sha256(canonicalPayload) === dataHash');
  const recomputed = generateDataHash(canonicalPayload);
  log(`  recomputed sha256=${recomputed}`);
  if (recomputed !== claimedHash) {
    fail(`hash mismatch: recomputed ${recomputed} !== dataHash ${claimedHash}`);
    return;
  }
  log('OK: sha256(canonicalPayload) === dataHash — block verified');

  // ── teardown ─────────────────────────────────────────────────────────
  httpServer.close();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

main().catch(err => {
  console.error(`[acceptance:${ADAPTER}] unexpected error:`, err);
  process.exitCode = 1;
});
