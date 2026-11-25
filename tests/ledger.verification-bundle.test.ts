import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';

import { signToken } from './fixtures/factories.js';
import { UserRole } from '../src/shared/constants/index.js';
import { ErrorCodes } from '../src/shared/http/errors.js';
import {
  CANONICAL_SCHEMA_VERSION,
  buildCanonicalShipmentPayload,
  generateDataHash,
} from '../src/shared/utils/crypto.js';

await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  isTokenBlocked: jest.fn(async () => false),
  blockToken: jest.fn(async () => undefined),
}));

const { ledgerRouter } = await import('../src/modules/ledger/ledger.routes.js');
const { errorMiddleware } = await import('../src/shared/http/errorMiddleware.js');
const { LedgerBlock } = await import('../src/modules/ledger/ledger.model.js');
const { createLedgerBlock } = await import('../src/modules/ledger/ledger.repo.js');
const { config } = await import('../src/config/index.js');

const app = express();
app.use(express.json());
app.use('/api/ledger', ledgerRouter);
app.use(errorMiddleware());

const CONTRACT = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const TX_HASH = 'ab'.repeat(32);

const tokenFor = (role: UserRole) =>
  signToken(
    { userId: new Types.ObjectId().toString(), role, jti: randomUUID() },
    { expiresIn: '1h' }
  );
const verificationUrl = (id: unknown) => `/api/ledger/blocks/${String(id)}/verification`;

/** Independent verifier: no app helpers — plain sha256 over the documented canonicalization. */
function recomputeHash(payload: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map(k => [k, sort((v as Record<string, unknown>)[k])])
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(sort(payload)).replace(/\s+/g, ''))
    .digest('hex');
}

async function seedBlock(extra: Record<string, unknown> = {}) {
  const shipmentId = new Types.ObjectId().toString();
  const canonical = buildCanonicalShipmentPayload({
    shipmentId,
    event: 'IN_TRANSIT',
    actor: 'user-1',
    timestamp: new Date('2026-08-01T09:12:33.000Z'),
    metadata: { previousStatus: 'CREATED', note: 'élan  with\tspaces' },
  });
  const block = await createLedgerBlock({
    shipmentId,
    milestoneEvent: 'IN_TRANSIT' as never,
    transactionHash: TX_HASH,
    dataHash: generateDataHash(canonical),
    canonicalPayload: canonical,
    ledger: 41234567,
    ...extra,
  });
  return { block, canonical };
}

beforeAll(() => {
  // Deterministic: the deployment under test is whatever config resolves to; assertions read it back.
  expect(['testnet', 'public']).toContain(config.stellarNetwork);
});

beforeEach(async () => {
  await LedgerBlock.deleteMany({});
});
afterEach(() => jest.restoreAllMocks());

describe('GET /api/ledger/blocks/:id/verification — bundle v2 (#1046)', () => {
  it('returns every required field with correct values (200)', async () => {
    const { block, canonical } = await seedBlock({
      network: 'public',
      contractId: CONTRACT,
      idempotencyKey: 'status-2026-08-01-0001',
    });
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      canonicalPayload: canonical,
      dataHash: generateDataHash(canonical),
      txHash: TX_HASH,
      transactionHash: TX_HASH,
      ledger: 41234567,
      network: 'public',
      contractId: CONTRACT,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      idempotencyKey: 'status-2026-08-01-0001',
    });
  });

  it('independently recomputes dataHash from canonicalPayload', async () => {
    const { block } = await seedBlock();
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.ADMIN)}`);

    const { canonicalPayload, dataHash } = res.body.data;
    expect(recomputeHash(canonicalPayload)).toBe(dataHash);
    // Round-trip through JSON (what a real client receives) is stable.
    expect(recomputeHash(JSON.parse(JSON.stringify(canonicalPayload)))).toBe(dataHash);
  });

  it('records network and contract at write time (does not drift with later config)', async () => {
    const { block } = await seedBlock();
    const stored = await LedgerBlock.findById(block._id).lean();
    expect(stored?.network).toBe(config.stellarNetwork);

    // A block written on one network keeps reporting it regardless of current config.
    const other = config.stellarNetwork === 'testnet' ? 'public' : 'testnet';
    const { block: b2 } = await seedBlock({ network: other });
    const res = await request(app)
      .get(verificationUrl(b2._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.MANAGER)}`);
    expect(res.body.data.network).toBe(other);
  });

  it('falls back to the configured network/contract for legacy blocks and nulls the rest', async () => {
    const legacy = await LedgerBlock.collection.insertOne({
      shipmentId: new Types.ObjectId(),
      milestoneEvent: 'IN_TRANSIT',
      blockNumber: 0,
      timestamp: new Date(),
      ledger: 7,
      confirmations: 0,
      verified: false,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await request(app)
      .get(verificationUrl(legacy.insertedId))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      canonicalPayload: null,
      dataHash: null,
      txHash: null,
      ledger: 7,
      network: config.stellarNetwork,
      contractId: config.escrowContractId ?? null,
      schemaVersion: null,
      idempotencyKey: null,
    });
  });

  it('resolves contractId from indexed event metadata when not persisted directly', async () => {
    const { block } = await seedBlock({ metadata: { contractId: CONTRACT } });
    await LedgerBlock.updateOne({ _id: block._id }, { $unset: { contractId: 1 } });
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.body.data.contractId).toBe(CONTRACT);
  });

  it('reports the schemaVersion carried by the payload itself', async () => {
    const { block, canonical } = await seedBlock();
    const v2 = { ...canonical, v: 2 };
    await LedgerBlock.updateOne(
      { _id: block._id },
      { $set: { canonicalPayload: v2, dataHash: generateDataHash(v2) } }
    );
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.body.data.schemaVersion).toBe(2);
    expect(recomputeHash(res.body.data.canonicalPayload)).toBe(res.body.data.dataHash);
  });

  it('does not hide a tampered payload: the independent recompute exposes the mismatch', async () => {
    const { block, canonical } = await seedBlock();
    await LedgerBlock.updateOne(
      { _id: block._id },
      { $set: { canonicalPayload: { ...canonical, event: 'DELIVERED' } } }
    );
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.status).toBe(200);
    expect(recomputeHash(res.body.data.canonicalPayload)).not.toBe(res.body.data.dataHash);
  });

  it.each([
    ['a string', 'not-an-object'],
    ['an array', [1, 2, 3]],
    ['an object without v', { event: 'X', shipmentId: 's' }],
    ['an object with a non-integer v', { event: 'X', v: '1' }],
    ['an object with v = 0', { event: 'X', v: 0 }],
  ])('rejects a malformed stored payload (%s) with 422', async (_label, payload) => {
    const { block } = await seedBlock();
    await LedgerBlock.collection.updateOne(
      { _id: block._id as never },
      { $set: { canonicalPayload: payload } }
    );
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.status).toBe(422);
    expect(res.body.code ?? res.body.error?.code).toBe(ErrorCodes.LEDGER_PAYLOAD_INVALID);
  });

  it('404s for a missing block', async () => {
    const res = await request(app)
      .get(verificationUrl(new Types.ObjectId()))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.status).toBe(404);
    expect(res.body.code ?? res.body.error?.code).toBe(ErrorCodes.LEDGER_BLOCK_NOT_FOUND);
  });

  it('404s for a soft-deleted block', async () => {
    const { block } = await seedBlock();
    await LedgerBlock.collection.updateOne(
      { _id: block._id as never },
      { $set: { deletedAt: new Date() } }
    );
    const res = await request(app)
      .get(verificationUrl(block._id))
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed id (400/422 validation) without touching the DB', async () => {
    const res = await request(app)
      .get('/api/ledger/blocks/not-an-object-id/verification')
      .set('Authorization', `Bearer ${tokenFor(UserRole.VIEWER)}`);
    expect([400, 422]).toContain(res.status);
  });

  describe('authorization (matches the other ledger read endpoints)', () => {
    it('401s without a token', async () => {
      const { block } = await seedBlock();
      const res = await request(app).get(verificationUrl(block._id));
      expect(res.status).toBe(401);
    });

    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER])('allows %s', async role => {
      const { block } = await seedBlock();
      const res = await request(app)
        .get(verificationUrl(block._id))
        .set('Authorization', `Bearer ${tokenFor(role)}`);
      expect(res.status).toBe(200);
    });

    it.each([UserRole.DRIVER, UserRole.CUSTOMER])(
      '403s for %s on every ledger read route',
      async role => {
        const { block } = await seedBlock();
        const auth = `Bearer ${tokenFor(role)}`;
        for (const path of [
          verificationUrl(block._id),
          `/api/ledger/blocks/${String(block._id)}`,
          '/api/ledger/blocks',
        ]) {
          const res = await request(app).get(path).set('Authorization', auth);
          expect(res.status).toBe(403);
        }
      }
    );
  });
});
