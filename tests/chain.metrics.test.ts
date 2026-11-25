import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import {
  CHAIN_OPERATIONS,
  instrumentSubmission,
  metricsRegistry,
  normalizeChainError,
  observeConfirmationLag,
  recordIndexerCursorEvent,
  recordIndexerPoll,
  resetChainMetricsForTests,
  setQueueDepthProvider,
} from '../src/infra/metrics/chainMetrics.js';
import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import { config } from '../src/config/index.js';

const KEY = Keypair.random();
const SHIP = '65f1a2b3c4d5e6f708192a3b';
const HASH = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';

async function sample(name: string, labels: Record<string, string> = {}): Promise<number> {
  for (const metric of await metricsRegistry.getMetricsAsJSON()) {
    for (const v of metric.values as { value: number; labels: object; metricName?: string }[]) {
      const sampleName = v.metricName ?? metric.name;
      if (
        sampleName === name &&
        Object.entries(labels).every(([k, val]) => (v.labels as Record<string, unknown>)[k] === val)
      ) {
        return v.value;
      }
    }
  }
  return 0;
}

const adapterWith = (submit: (tx: Transaction) => Promise<{ hash: string; ledger: number }>) =>
  new SimulatedAdapter({
    secretKey: KEY.secret(),
    networkPassphrase: Networks.TESTNET,
    horizon: {
      loadAccount: async () => new Account(KEY.publicKey(), '1'),
      submitTransaction: submit,
      listTransactions: async () => [],
    },
  });

beforeEach(() => resetChainMetricsForTests());
afterEach(() => jest.useRealTimers());

describe('submission metrics (#1044)', () => {
  it('records success count and latency when an adapter anchors', async () => {
    const adapter = adapterWith(async () => ({ hash: 'a'.repeat(64), ledger: 5 }));
    await adapter.anchorEvent({ shipment_id: SHIP, data_hash: HASH, actor: KEY.publicKey() });

    expect(
      await sample('navin_chain_submissions_total', {
        operation: 'anchor_event',
        outcome: 'success',
      })
    ).toBe(1);
    expect(
      await sample('navin_chain_submission_duration_seconds_count', {
        operation: 'anchor_event',
        outcome: 'success',
      })
    ).toBe(1);
    expect(
      await sample('navin_chain_submissions_total', {
        operation: 'anchor_event',
        outcome: 'failure',
      })
    ).toBe(0);
  });

  it('records a failure by normalized error code and rethrows the original error', async () => {
    const adapter = adapterWith(async () => {
      throw new Error('boom: tx abc123 for GABC... secret');
    });
    await expect(
      adapter.releaseEscrow({ caller: KEY.publicKey(), shipment_id: SHIP })
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_UNKNOWN });

    expect(
      await sample('navin_chain_submissions_total', {
        operation: 'release_escrow',
        outcome: 'failure',
      })
    ).toBe(1);
    expect(
      await sample('navin_chain_submission_failures_total', {
        operation: 'release_escrow',
        error_code: ErrorCodes.CHAIN_UNKNOWN,
      })
    ).toBe(1);
    expect(
      await sample('navin_chain_submission_duration_seconds_count', {
        operation: 'release_escrow',
        outcome: 'failure',
      })
    ).toBe(1);
  });

  it('measures submission latency', async () => {
    jest.useFakeTimers();
    const p = instrumentSubmission('anchor_event', async () => {
      await new Promise(r => setTimeout(r, 3000));
      return 1;
    });
    await jest.advanceTimersByTimeAsync(3000);
    await p;
    const sum = await sample('navin_chain_submission_duration_seconds_sum', {
      operation: 'anchor_event',
      outcome: 'success',
    });
    // fake timers do not move hrtime; the observation must still be recorded and finite
    expect(Number.isFinite(sum)).toBe(true);
    expect(
      await sample('navin_chain_submission_duration_seconds_count', { operation: 'anchor_event' })
    ).toBe(1);
  });

  it('passes the result through unchanged', async () => {
    await expect(instrumentSubmission('anchor_event', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('error normalization keeps labels bounded', () => {
  it.each([
    [new AppError(409, 'x', ErrorCodes.CHAIN_INVALID_STATUS), 'ERR_CHAIN_INVALID_STATUS'],
    [new AppError(500, 'x', ErrorCodes.INTERNAL_ERROR), 'ERR_OTHER'],
    [new Error('tx 3f79bb7b... failed for GABQ...'), 'ERR_UNCLASSIFIED'],
    ['string', 'ERR_UNCLASSIFIED'],
    [undefined, 'ERR_UNCLASSIFIED'],
  ])('%p -> %s', (err, label) => {
    expect(normalizeChainError(err)).toBe(label);
  });

  it('an AppError with an arbitrary ERR_CHAIN_-looking code is not trusted', () => {
    expect(normalizeChainError(new AppError(400, 'x', 'ERR_CHAIN_' + 'X'.repeat(50)))).toBe(
      'ERR_OTHER'
    );
  });

  it('never leaks ids, addresses or messages into any label value', async () => {
    const secret = `GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC-${SHIP}-${'f'.repeat(64)}`;
    await instrumentSubmission('anchor_event', async () => {
      throw new Error(secret);
    }).catch(() => undefined);
    await instrumentSubmission('release_escrow', async () => {
      throw new AppError(500, secret, secret);
    }).catch(() => undefined);
    observeConfirmationLag(secret, new Date());
    recordIndexerCursorEvent(new Date());

    const text = await metricsRegistry.metrics();
    expect(text).not.toContain(SHIP);
    expect(text).not.toContain('GABQGAYD');
    expect(text).not.toContain('f'.repeat(64));
    expect(text).not.toContain('boom');

    const allowed = new Set<string>([
      ...CHAIN_OPERATIONS,
      'success',
      'failure',
      'ERR_OTHER',
      'ERR_UNCLASSIFIED',
      config.stellarNetwork,
    ]);
    const json = await metricsRegistry.getMetricsAsJSON();
    for (const m of json) {
      for (const v of m.values) {
        for (const [k, val] of Object.entries(v.labels)) {
          if (['le', 'quantile'].includes(k) || k === 'event' || k === 'queue' || k === 'state')
            continue;
          expect(allowed.has(String(val))).toBe(true);
        }
      }
    }
  });
});

describe('confirmation lag', () => {
  it('observes now - event time for known events', async () => {
    const now = new Date('2026-09-27T10:16:30Z');
    observeConfirmationLag('anchor', '2026-09-27T10:15:30Z', now);
    expect(await sample('navin_chain_confirmation_lag_seconds_count', { event: 'anchor' })).toBe(1);
    expect(await sample('navin_chain_confirmation_lag_seconds_sum', { event: 'anchor' })).toBe(60);
  });

  it('clamps clock skew to zero and ignores unknown events / bad timestamps', async () => {
    observeConfirmationLag('anchor', '2026-09-27T10:20:00Z', new Date('2026-09-27T10:15:00Z'));
    expect(await sample('navin_chain_confirmation_lag_seconds_sum', { event: 'anchor' })).toBe(0);
    observeConfirmationLag('not_an_event', '2026-09-27T10:15:00Z');
    observeConfirmationLag('anchor', 'garbage');
    observeConfirmationLag('anchor', undefined);
    expect(await sample('navin_chain_confirmation_lag_seconds_count', { event: 'anchor' })).toBe(1);
    expect(
      await sample('navin_chain_confirmation_lag_seconds_count', { event: 'not_an_event' })
    ).toBe(0);
  });
});

describe('queue depth and indexer cursor age (scrape-time)', () => {
  it('reports queue depth by queue/state from the provider', async () => {
    setQueueDepthProvider(async () => ({
      transaction_queue: { waiting: 7, active: 2, delayed: 0, failed: 1 },
    }));
    const text = await metricsRegistry.metrics();
    expect(text).toMatch(
      /navin_chain_queue_depth\{[^}]*queue="transaction_queue"[^}]*state="waiting"[^}]*\} 7/
    );
    expect(text).toMatch(/state="failed"[^}]*\} 1/);
  });

  it('omits queue depth (no false zero) when the provider fails', async () => {
    setQueueDepthProvider(async () => {
      throw new Error('redis down');
    });
    const text = await metricsRegistry.metrics();
    expect(text).not.toMatch(/navin_chain_queue_depth\{/);
  });

  it('computes cursor age at scrape time from the newest processed event', async () => {
    recordIndexerCursorEvent(new Date(Date.now() - 90_000));
    const age = await sample('navin_indexer_cursor_age_seconds');
    expect(age).toBeGreaterThanOrEqual(90);
    expect(age).toBeLessThan(95);
  });

  it('never moves the cursor backwards and reports NaN (unknown, not 0) before any event', async () => {
    expect(await sample('navin_indexer_cursor_age_seconds')).toBeNaN();
    expect(await metricsRegistry.metrics()).toMatch(
      /^navin_indexer_cursor_age_seconds\{[^}]*\} nan$/im
    );
    recordIndexerCursorEvent(new Date(Date.now() - 10_000));
    recordIndexerCursorEvent(new Date(Date.now() - 500_000));
    expect(await sample('navin_indexer_cursor_age_seconds')).toBeLessThan(15);
  });

  it('records the last successful poll time', async () => {
    recordIndexerPoll(new Date('2026-09-27T10:00:00Z'));
    expect(await sample('navin_indexer_last_poll_timestamp_seconds')).toBe(
      Date.parse('2026-09-27T10:00:00Z') / 1000
    );
  });
});

describe('GET /api/metrics', () => {
  async function appWith(token: string | undefined) {
    (config as { metricsToken?: string }).metricsToken = token;
    const { metricsHandler } = await import('../src/infra/metrics/metricsServer.js');
    const app = express();
    app.get('/api/metrics', metricsHandler);
    return app;
  }
  afterEach(() => {
    (config as { metricsToken?: string }).metricsToken = undefined;
  });

  it('is disabled (404) when METRICS_TOKEN is unset', async () => {
    const res = await request(await appWith(undefined)).get('/api/metrics');
    expect(res.status).toBe(404);
  });

  it('401s without or with a wrong bearer token', async () => {
    const app = await appWith('t'.repeat(20));
    expect((await request(app).get('/api/metrics')).status).toBe(401);
    expect(
      (await request(app).get('/api/metrics').set('Authorization', 'Bearer nope')).status
    ).toBe(401);
  });

  it('serves Prometheus text with the token, labelled with the network', async () => {
    await instrumentSubmission('anchor_event', async () => 1);
    const app = await appWith('t'.repeat(20));
    const res = await request(app)
      .get('/api/metrics')
      .set('Authorization', `Bearer ${'t'.repeat(20)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('navin_chain_submissions_total');
    expect(res.text).toContain(`network="${config.stellarNetwork}"`);
  });
});

describe('indexer instrumentation', () => {
  it('observes confirmation lag at verification and feeds cursor age', async () => {
    const { indexStellarTransactions } = await import('../src/workers/stellar-indexer.worker.js');
    const { LedgerBlock } = await import('../src/modules/ledger/ledger.model.js');
    const { parseChainEvent } = await import('../src/shared/types/chain.js');
    const fixture = (await import('./fixtures/chain/events.json', { with: { type: 'json' } }))
      .default;
    await LedgerBlock.deleteMany({});

    const closedAt = new Date(Date.now() - 120_000).toISOString();
    const event = parseChainEvent({ ...fixture.events.anchor, ledger_closed_at: closedAt });
    let confirmations = 0;
    let streamed = false;
    const adapter = {
      anchorEvent: jest.fn(),
      releaseEscrow: jest.fn(),
      streamEvents: async function* () {
        // The cursor has advanced after the first run, so the event is not re-streamed.
        if (!streamed) yield event;
        streamed = true;
      },
      getConfirmationCount: async () => confirmations,
    } as never;

    // Not yet confirmed: no lag observation, but the cursor advanced.
    await indexStellarTransactions(adapter, '', { persistCursor: false });
    expect(await sample('navin_chain_confirmation_lag_seconds_count', { event: 'anchor' })).toBe(0);

    // Reconciliation verifies it later: lag measured from the chain event time.
    confirmations = 5;
    const summary = await indexStellarTransactions(adapter, '', { persistCursor: false });
    expect(summary.reverified).toBe(1);
    expect(await sample('navin_chain_confirmation_lag_seconds_count', { event: 'anchor' })).toBe(1);
    expect(
      await sample('navin_chain_confirmation_lag_seconds_sum', { event: 'anchor' })
    ).toBeGreaterThanOrEqual(120);
  });
});
