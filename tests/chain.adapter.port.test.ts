import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';

import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import type { ChainEvent } from '../src/shared/types/chain.js';

import { MockChainAdapter, consume } from './types/chainAdapter.typecheck.js';

const TYPECHECK_FILE = join(process.cwd(), 'tests/types/chainAdapter.typecheck.ts');

const events = (
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/chain/events.json'), 'utf8')) as {
    events: Record<string, ChainEvent>;
  }
).events;

describe('ChainAdapter port — type-level', () => {
  it('mock adapter and consumers compile; every @ts-expect-error is used', () => {
    const program = ts.createProgram([TYPECHECK_FILE], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      types: ['node'],
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  }, 60_000);
});

describe('ChainAdapter port — mock adapter behaviour', () => {
  const stream = [events.anchor!, events.esc_init!, events.esc_rel!];

  it('streams events in order and resumes strictly after the cursor', async () => {
    const adapter = new MockChainAdapter(stream);
    const all: ChainEvent[] = [];
    for await (const e of adapter.streamEvents()) all.push(e);
    expect(all.map(e => e.name)).toEqual(['anchor', 'esc_init', 'esc_rel']);

    const resumed: ChainEvent[] = [];
    for await (const e of adapter.streamEvents(events.anchor!.id)) resumed.push(e);
    expect(resumed.map(e => e.name)).toEqual(['esc_init', 'esc_rel']);
  });

  it('releaseEscrow rejects with AppError(ERR_CHAIN_*) instead of { success: false }', async () => {
    const adapter = new MockChainAdapter();
    await expect(
      adapter.releaseEscrow({ payment_id: 'missing', proof_hash: 'a'.repeat(64) })
    ).rejects.toMatchObject({ statusCode: 404, code: ErrorCodes.CHAIN_ESCROW_NOT_FOUND });
    await expect(
      adapter.releaseEscrow({ payment_id: 'missing', proof_hash: 'a'.repeat(64) })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('resolves with a receipt only on success', async () => {
    const adapter = new MockChainAdapter(stream, new Set(['p1']));
    await expect(consume(adapter)).resolves.toEqual([events.anchor!.data[0], 'a'.repeat(64)]);
  });
});
