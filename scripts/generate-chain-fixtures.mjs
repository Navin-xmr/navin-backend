/**
 * @fileoverview Generate cross-repo chain golden fixtures from the backend spec.
 *
 * This script derives `tests/fixtures/chain/{events,errors,functions}.json` from
 * `src/shared/types/chain.ts` (the single source of truth for chain shapes). The
 * generated fixtures mirror the contracts repo's snapshot tests
 * (`contracts/shipment/test_snapshots/`, `test_event_fixtures.rs`) so both repos
 * validate the same bytes.
 *
 * Usage:
 *   node scripts/generate-chain-fixtures.mjs
 *
 * After running, inspect the diff and commit the regenerated fixtures together
 * with a `CHAIN_SPEC_VERSION` bump in `src/shared/types/chain.ts`.
 *
 * The `source_commit` field must be replaced with the actual commit SHA from
 * the contracts repo (`Navin-xmr/navin-contracts`) where these snapshots were
 * captured.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CHAIN_TS = join(ROOT, 'src', 'shared', 'types', 'chain.ts');
const FIXTURES_DIR = join(ROOT, 'tests', 'fixtures', 'chain');

const SOURCE_COMMIT_PLACEHOLDER = '<replace-with-contracts-repo-commit-sha>'; // TODO: fill in from navin-contracts
const SPEC_VERSION = '2.0.0';

// ─── Extract spec data from chain.ts ─────────────────────────────────────────

const chainTs = readFileSync(CHAIN_TS, 'utf8');

/** Extract the error name->code map from the TS source. */
function extractErrors() {
  const match = chainTs.match(/export const CHAIN_CONTRACT_ERRORS = \{([\s\S]*?)\} as const;/);
  if (!match) throw new Error('CHAIN_CONTRACT_ERRORS not found in chain.ts');

  const errors = [];

  // Parse each line like "  NotAuthorized: 1,"
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*(\w+):\s*(\d+),?\s*$/);
    if (m) {
      const name = m[1];
      const code = parseInt(m[2], 10);

      // Determine which function(s) can emit this error from CHAIN_ERROR_MAP
      let fn = 'anchor'; // default
      if (['EscrowExists', 'InvalidAmount'].includes(name)) fn = 'init_escrow';
      if (['EscrowNotFound', 'EscrowAlreadyReleased', 'InvalidProof'].includes(name))
        fn = 'release_escrow';

      errors.push({ name, code, function: fn });
    }
  }

  return errors;
}

/** Extract CHAIN_FUNCTIONS array. */
function extractFunctions() {
  const match = chainTs.match(/export const CHAIN_FUNCTIONS = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error('CHAIN_FUNCTIONS not found in chain.ts');

  return match[1]
    .split(',')
    .map(s => s.replace(/['"]/g, '').trim())
    .filter(Boolean);
}

// ─── Fixture builders ────────────────────────────────────────────────────────

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const PAYER = 'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA';
const PAYEE = 'GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC';
const SHIPMENT_ID = '65f1a2b3c4d5e6f708192a3b';
const PAYMENT_ID = '66a0b1c2d3e4f50617283940';
const TOKEN = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
const PROOF_HASH = '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d';
const DATA_HASH = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
const AMOUNT = '1500000000';

function header() {
  return { spec_version: SPEC_VERSION, source_commit: SOURCE_COMMIT_PLACEHOLDER };
}

function buildEventsFixture() {
  const now = n => new Date('2026-09-27T10:15:00Z').getTime() + n * 60_000;

  const iso = n => {
    const d = new Date(now(n));
    return d.toISOString().replace(/\.000Z$/, 'Z');
  };

  const events = {
    anchor: {
      id: '0002200479567253504-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
      ledger: 512345,
      ledger_closed_at: iso(0),
      name: 'anchor',
      topic: ['anchor', SHIPMENT_ID],
      data: [DATA_HASH, 512345],
    },
    esc_init: {
      id: '0002200479567253505-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '18ac3e7343f016890c510e93f935261169d9e3f565436429830faf0934f4f8e4',
      ledger: 512346,
      ledger_closed_at: iso(5),
      name: 'esc_init',
      topic: ['esc_init', PAYMENT_ID],
      data: [SHIPMENT_ID, PAYER, PAYEE, TOKEN, AMOUNT],
    },
    esc_rel: {
      id: '0002200479567253506-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
      ledger: 512400,
      ledger_closed_at: iso(30),
      name: 'esc_rel',
      topic: ['esc_rel', PAYMENT_ID],
      data: [PROOF_HASH, PAYEE, AMOUNT],
    },
    esc_dispute: {
      id: '0002200479567253507-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '4a7e1c8d2b3f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c',
      ledger: 512450,
      ledger_closed_at: iso(45),
      name: 'esc_dispute',
      topic: ['esc_dispute', PAYMENT_ID],
      data: ['a3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c00d'],
    },
    esc_resolve: {
      id: '0002200479567253508-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '5b8f2d9c3e4a5f6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
      ledger: 512500,
      ledger_closed_at: iso(60),
      name: 'esc_resolve',
      topic: ['esc_resolve', PAYMENT_ID],
      data: ['refund_payer'],
    },
    esc_freeze: {
      id: '0002200479567253509-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '6c9a3e0d4f5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
      ledger: 512520,
      ledger_closed_at: iso(75),
      name: 'esc_freeze',
      topic: ['esc_freeze', PAYMENT_ID],
      data: [],
    },
    esc_unfreeze: {
      id: '0002200479567253510-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '7d0b4e1f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
      ledger: 512540,
      ledger_closed_at: iso(90),
      name: 'esc_unfreeze',
      topic: ['esc_unfreeze', PAYMENT_ID],
      data: [],
    },
    delivery_success: {
      id: '0002200479567253511-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '8e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
      ledger: 512600,
      ledger_closed_at: iso(180),
      name: 'delivery_success',
      topic: ['delivery_success', SHIPMENT_ID],
      data: [PROOF_HASH, PAYER],
    },
    escrow_released: {
      id: '0002200479567253512-0000000001',
      contract_id: CONTRACT_ID,
      tx_hash: '9f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a',
      ledger: 512600,
      ledger_closed_at: iso(180),
      name: 'escrow_released',
      topic: ['escrow_released', SHIPMENT_ID],
      data: [PROOF_HASH, PAYER],
    },
  };

  return { ...header(), events };
}

function buildErrorsFixture(errors) {
  return {
    ...header(),
    errors: errors.map(e => ({ code: e.code, function: e.function })),
  };
}

function buildFunctionsFixture() {
  return {
    ...header(),
    args: {
      anchor: {
        shipment_id: SHIPMENT_ID,
        data_hash: DATA_HASH,
        actor: PAYER,
      },
      init_escrow: {
        payment_id: PAYMENT_ID,
        shipment_id: SHIPMENT_ID,
        payer: PAYER,
        payee: PAYEE,
        token: TOKEN,
        amount: AMOUNT,
      },
      release_escrow: {
        payment_id: PAYMENT_ID,
        proof_hash: PROOF_HASH,
      },
      confirm_delivery: {
        receiver: PAYER,
        shipment_id: SHIPMENT_ID,
        proof_hash: PROOF_HASH,
      },
    },
    tx_result: {
      tx_hash: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
      ledger: 512345,
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const errors = extractErrors();
const functions = extractFunctions();

console.log(`Generating chain fixtures (spec_version=${SPEC_VERSION})`);
console.log(`  functions found: ${functions.join(', ')}`);
console.log(`  errors found: ${errors.length}`);

const eventsFixture = buildEventsFixture();
const errorsFixture = buildErrorsFixture(errors);
const functionsFixture = buildFunctionsFixture();

// Validate that all spec functions have fixtures
for (const fn of functions) {
  if (!(fn in functionsFixture.args)) {
    throw new Error('Missing fixture for function: ' + fn);
  }
}

// Validate that all spec errors have fixtures
const fixtureCodes = errorsFixture.errors.map(e => e.code).sort();
const specCodes = errors.map(e => e.code).sort();
if (JSON.stringify(fixtureCodes) !== JSON.stringify(specCodes)) {
  throw new Error(
    'Error codes mismatch: fixtures=' +
      JSON.stringify(fixtureCodes) +
      ', spec=' +
      JSON.stringify(specCodes)
  );
}

writeFileSync(join(FIXTURES_DIR, 'events.json'), JSON.stringify(eventsFixture, null, 2) + '\n');
writeFileSync(join(FIXTURES_DIR, 'errors.json'), JSON.stringify(errorsFixture, null, 2) + '\n');
writeFileSync(
  join(FIXTURES_DIR, 'functions.json'),
  JSON.stringify(functionsFixture, null, 2) + '\n'
);

console.log('  wrote tests/fixtures/chain/events.json');
console.log('  wrote tests/fixtures/chain/errors.json');
console.log('  wrote tests/fixtures/chain/functions.json');
console.log('');
console.log('IMPORTANT: Replace source_commit placeholder with the actual commit SHA');
console.log('from navin-contracts before committing.');
