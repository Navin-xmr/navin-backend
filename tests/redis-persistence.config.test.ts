import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yamljs';

/**
 * Static guard for the Redis durability configuration introduced by #637.
 *
 * The runtime half of the check (`scripts/redis-persistence-probe.mjs`, run
 * against a real Compose stack in the `redis-persistence` CI job) needs Docker,
 * so it cannot run in this suite. These assertions cover the parts that are
 * verifiable here: that the compose file still declares AOF plus the named
 * volume, and that CI is still wired to exercise the restart boundary.
 */

type YamlNode = Record<string, unknown>;

function loadRepoYaml(relativePath: string): YamlNode {
  return YAML.load(fileURLToPath(new URL(relativePath, import.meta.url))) as YamlNode;
}

function readRepoText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function asRecord(value: unknown): YamlNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected a mapping, got: ${JSON.stringify(value)}`);
  }
  return value as YamlNode;
}

describe('docker-compose.yml Redis durability', () => {
  const compose = loadRepoYaml('../docker-compose.yml');
  const redis = asRecord(asRecord(compose.services).redis);

  it('enables AOF persistence', () => {
    const command = Array.isArray(redis.command) ? redis.command.map(String) : [String(redis.command)];
    expect(command).toContain('--appendonly');
    expect(command[command.indexOf('--appendonly') + 1]).toBe('yes');
  });

  it('mounts the named redis_data volume on /data', () => {
    const volumes = (redis.volumes as unknown[]).map((entry) =>
      typeof entry === 'string' ? entry : `${asRecord(entry).source}:${asRecord(entry).target}`
    );
    expect(volumes).toEqual(expect.arrayContaining([expect.stringMatching(/^redis_data:/)]));
    expect(volumes.some((mount) => mount.startsWith('redis_data:') && mount.endsWith('/data'))).toBe(
      true
    );
  });

  it('declares redis_data at the top level', () => {
    expect(Object.keys(asRecord(compose.volumes))).toContain('redis_data');
  });
});

describe('redis-persistence-probe.mjs', () => {
  const probe = readRepoText('../scripts/redis-persistence-probe.mjs');

  it('defaults to the transaction_queue contract name', () => {
    expect(probe).toContain("REDIS_PERSISTENCE_QUEUE ?? 'transaction_queue'");
  });

  it('exposes an enqueue phase and a verify phase', () => {
    expect(probe).toContain("phase === 'enqueue'");
    expect(probe).toContain("phase === 'verify'");
  });

  it('re-asserts the AOF setting at verify time', () => {
    // Without this, deleting `--appendonly yes` would only be caught by the
    // static compose check, and only on the first run against a fresh stack.
    expect(probe).toContain("client.config('GET', 'appendonly')");
  });

  it('processes the surviving job rather than only inspecting it', () => {
    expect(probe).toContain('new Worker(');
    expect(probe).toContain('waitUntilFinished');
  });
});

describe('ci.yml Redis persistence job', () => {
  const workflow = loadRepoYaml('../.github/workflows/ci.yml');
  const job = asRecord(asRecord(workflow.jobs)['redis-persistence']);
  const steps = (job.steps as Record<string, unknown>[]).map((step) =>
    String(asRecord(step).run ?? '')
  );
  const allRuns = steps.join('\n');

  it('is gated on a redis-specific path filter', () => {
    expect(asRecord(asRecord(workflow.jobs).changes).outputs).toHaveProperty('redis');
  });

  it('restarts only the redis container instead of recreating it', () => {
    expect(allRuns).toMatch(/compose -p redis-persistence .*restart redis/);
    // The restart phase must not drop the volume, or it would assert nothing.
    const restartStep = allRuns.split(/restart redis/)[0];
    expect(restartStep).not.toContain('down -v');
  });

  it('runs the probe in both phases', () => {
    expect(allRuns).toContain('redis-persistence-probe.mjs enqueue');
    expect(allRuns).toContain('redis-persistence-probe.mjs verify');
  });

  it('scopes teardown to its own compose project', () => {
    // `down -v` on the shared project name would delete a developer's volumes.
    expect(allRuns).toMatch(/compose -p redis-persistence .*down -v/);
    expect(allRuns).not.toMatch(/compose -p navin-backend .*down -v/);
  });
});
