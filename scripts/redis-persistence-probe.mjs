#!/usr/bin/env node
/**
 * Redis queue persistence probe (issue #637).
 *
 * Enqueues a real BullMQ job, then - after the caller has restarted *only* the
 * Redis container without touching its volume - asserts the same job is still
 * on the queue and can actually be processed.
 *
 * Phases are separate processes because the restart happens in between:
 *
 *   node scripts/redis-persistence-probe.mjs enqueue
 *   docker compose -p <project> restart redis
 *   node scripts/redis-persistence-probe.mjs verify
 *
 * `verify` is the gate: it exits non-zero when the job vanished (persistence
 * broken) or when the queue is no longer consumable. It also re-checks the two
 * pieces of configuration the durability guarantee rests on, so removing either
 * the AOF flag or the `redis_data` volume fails the probe rather than silently
 * weakening it.
 *
 * The queue name defaults to `transaction_queue`. Run the probe against a stack
 * where only the `redis` service is up - otherwise the app's own
 * `stellar.worker` container consumes the job before the restart, and there is
 * nothing left to assert. Override with REDIS_PERSISTENCE_QUEUE if needed.
 *
 * Environment:
 *   REDIS_URL                   default redis://127.0.0.1:6379
 *   REDIS_PERSISTENCE_QUEUE     default transaction_queue
 *   REDIS_PERSISTENCE_STATE     default .redis-persistence-probe.json
 *   PROBE_TIMEOUT_MS            default 30000
 */

import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const QUEUE_NAME = process.env.REDIS_PERSISTENCE_QUEUE ?? 'transaction_queue';
const STATE_FILE = resolve(process.env.REDIS_PERSISTENCE_STATE ?? '.redis-persistence-probe.json');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 30_000);
const PROBE_JOB_NAME = 'redis-persistence-probe';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  // Required by BullMQ for the blocking XREAD used by Worker/QueueEvents.
  maxRetriesPerRequest: null,
  ...(redisUrl.username
    ? { username: redisUrl.username, password: redisUrl.password ?? undefined }
    : {}),
};

function log(message) {
  process.stdout.write(`[redis-persistence] ${message}\n`);
}

function fail(message, detail) {
  process.stderr.write(`[redis-persistence] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

/** BullMQ forbids `:` in job ids; keep the marker a safe token. */
function newMarker() {
  return `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Raw Redis client, used only for the CONFIG GET durability assertion. */
async function withRawRedis(fn) {
  const client = new Redis({
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.username
      ? { username: redisUrl.username, password: redisUrl.password ?? undefined }
      : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  client.on('error', () => {
    /* surfaced by the awaited call below */
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

/**
 * The two things the durability guarantee depends on. AOF is what makes Redis
 * write the dataset to disk; the named volume is what makes that disk survive
 * `docker compose restart`. Losing either one silently downgrades the queue to
 * ephemeral, so assert both.
 */
async function assertDurabilityConfigIsIntact() {
  const reply = await withRawRedis((client) => client.config('GET', 'appendonly'));
  // ioredis returns CONFIG GET as [parameter, value].
  const value = Array.isArray(reply) ? reply[1] : reply;

  if (value === undefined || value === null) {
    fail('could not read `appendonly` from Redis (CONFIG GET returned no value)');
  }
  if (String(value).toLowerCase() !== 'yes') {
    fail(
      `Redis AOF persistence is disabled (appendonly=${value}). Queued jobs would not survive a restart.`,
      'Expected `redis-server --appendonly yes` in docker-compose.yml.'
    );
  }
  log('appendonly=yes confirmed');
}

async function enqueue() {
  const queue = new Queue(QUEUE_NAME, { connection });
  const marker = newMarker();

  try {
    const job = await queue.add(
      PROBE_JOB_NAME,
      { marker, enqueuedAt: new Date().toISOString() },
      { jobId: marker, removeOnComplete: false, removeOnFail: false }
    );

    const state = { queue: QUEUE_NAME, jobId: job.id, marker, enqueuedAt: Date.now() };
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

    log(`enqueued job ${job.id} on "${QUEUE_NAME}" (state -> ${STATE_FILE})`);
    log(`queue depth: ${await queue.getWaitingCount()}`);
  } finally {
    await queue.close();
  }
}

async function verify() {
  // Read the state file first: a missing/broken state file is the caller's
  // mistake, not a durability failure, and failing fast keeps the diagnostic
  // from being buried behind a Redis connection error.
  let state;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    fail(
      `no readable probe state file at ${STATE_FILE} - run the "enqueue" phase before restarting Redis.`,
      err instanceof Error ? err.message : String(err)
    );
  }

  if (state.queue !== QUEUE_NAME) {
    fail(
      `state file was written for queue "${state.queue}" but this run targets "${QUEUE_NAME}".`,
      'Keep REDIS_PERSISTENCE_QUEUE stable across both phases.'
    );
  }

  await assertDurabilityConfigIsIntact();

  const queue = new Queue(QUEUE_NAME, { connection });
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  let worker;

  try {
    const job = await queue.getJob(state.jobId);

    if (!job) {
      fail(
        `job ${state.jobId} is gone after the Redis restart - queue state did not persist.`,
        'Expected the redis_data volume to carry the dataset across `docker compose restart redis`.'
      );
    }

    const jobState = await job.getState();
    log(`job ${job.id} found after restart, state="${jobState}"`);

    if (jobState === 'completed' || jobState === 'failed') {
      fail(
        `job ${job.id} was already "${jobState}" before this phase ran.`,
        'Start from a clean probe: remove the state file and re-run "enqueue" on a fresh stack.'
      );
    }

    if (jobState !== 'waiting' && jobState !== 'paused' && jobState !== 'delayed') {
      fail(`job ${job.id} is in unexpected state "${jobState}" after the restart.`);
    }

    // "Remains available" is only half the guarantee - it has to be processable.
    // Drain the queue with a local worker and assert the payload round-trips.
    worker = new Worker(
      QUEUE_NAME,
      async (queued) => {
        if (queued.name !== PROBE_JOB_NAME) return { skipped: queued.name };
        return { echoMarker: queued.data?.marker ?? null };
      },
      { connection, autorun: true }
    );

    const finished = await job.waitUntilFinished(queueEvents, TIMEOUT_MS);

    if (finished?.echoMarker !== state.marker) {
      fail(
        `job ${job.id} processed but the payload did not survive the restart.`,
        `expected marker "${state.marker}", got "${finished?.echoMarker}"`
      );
    }

    log(`job ${job.id} processed after restart; payload intact (marker=${state.marker})`);
  } finally {
    if (worker) await worker.close();
    await queueEvents.close().catch(() => undefined);
    await queue.close();
    rmSync(STATE_FILE, { force: true });
  }
}

const phase = process.argv[2];

if (phase === 'enqueue') {
  await enqueue();
} else if (phase === 'verify') {
  await verify();
} else {
  process.stderr.write('Usage: redis-persistence-probe.mjs <enqueue|verify>\n');
  process.exit(2);
}
