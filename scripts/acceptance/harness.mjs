#!/usr/bin/env node
/**
 * Shared Chain Conformance Acceptance Harness (Issue #807 / P6-20).
 *
 * Provides deterministic cryptographic hashing, Soroban/Stellar spec validation,
 * and an executable test harness + optional live HTTP compose probe for the four
 * chain conformance lifecycle scenarios:
 *   1. scan -> anchored
 *   2. deliver -> escrow released
 *   3. indexer ingests emitted event
 *   4. frontend verifies badge via bundle endpoint
 */

import crypto from 'node:crypto';

export const CHAIN_SPEC_VERSION = '1.0.0-draft';
export const DEFAULT_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
export const DEFAULT_ACTOR_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
export const DEFAULT_PAYEE_ADDRESS = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBX7Y';

const SYMBOL_REGEX = /^[A-Za-z0-9_]{1,32}$/;
const BYTES32_HEX_REGEX = /^[0-9a-f]{64}$/;
const STRKEY_REGEX = /^[GC][A-Z2-7]{55}$/;

/**
 * Recursively sorts object keys for deterministic canonical JSON serialization.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sortedKeys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

/**
 * Computes a deterministic lowercase 64-char SHA-256 hex digest over any payload.
 */
export function computeCanonicalHash(payload) {
  const serialized = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Validates `anchor(shipment_id, data_hash, actor)` input against the v1 chain spec.
 */
export function validateAnchorInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('ERR_CHAIN_INVALID_ARGS: anchor input must be an object');
  }
  if (!SYMBOL_REGEX.test(String(input.shipment_id ?? ''))) {
    throw new Error(`ERR_CHAIN_INVALID_SYMBOL: invalid shipment_id "${input.shipment_id}"`);
  }
  if (!BYTES32_HEX_REGEX.test(String(input.data_hash ?? ''))) {
    throw new Error('ERR_CHAIN_INVALID_HASH: data_hash must be 64-char lowercase hex');
  }
  if (!STRKEY_REGEX.test(String(input.actor ?? ''))) {
    throw new Error('ERR_CHAIN_UNAUTHORIZED: actor must be a valid Stellar StrKey address');
  }
}

/**
 * Validates `release_escrow(payment_id, proof_hash)` input against the v1 chain spec.
 */
export function validateReleaseEscrowInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('ERR_CHAIN_INVALID_ARGS: release_escrow input must be an object');
  }
  if (!SYMBOL_REGEX.test(String(input.payment_id ?? ''))) {
    throw new Error(`ERR_CHAIN_INVALID_SYMBOL: invalid payment_id "${input.payment_id}"`);
  }
  if (!BYTES32_HEX_REGEX.test(String(input.proof_hash ?? ''))) {
    throw new Error('ERR_CHAIN_INVALID_PROOF: proof_hash must be 64-char lowercase hex');
  }
}

/**
 * Validates an emitted contract event envelope against `docs/chain-interface.md`.
 */
export function validateChainEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('ERR_CHAIN_INVALID_EVENT: event must be an object');
  }
  if (typeof event.id !== 'string' || event.id.length === 0) {
    throw new Error('ERR_CHAIN_INVALID_EVENT: event.id is required');
  }
  if (!STRKEY_REGEX.test(String(event.contract_id ?? '')) || !event.contract_id.startsWith('C')) {
    throw new Error('ERR_CHAIN_INVALID_EVENT: contract_id must be a C... contract StrKey');
  }
  if (!BYTES32_HEX_REGEX.test(String(event.tx_hash ?? ''))) {
    throw new Error('ERR_CHAIN_INVALID_EVENT: tx_hash must be 64-char lowercase hex');
  }
  if (!Number.isInteger(event.ledger) || event.ledger <= 0) {
    throw new Error('ERR_CHAIN_INVALID_EVENT: ledger must be a positive integer');
  }
  if (!['anchor', 'esc_init', 'esc_rel'].includes(event.name)) {
    throw new Error(`ERR_CHAIN_INVALID_EVENT: unsupported event name "${event.name}"`);
  }
  return event;
}

/**
 * Creates a self-contained Conformance Chain Test Harness that models the full
 * v1 contract state machine (`anchor`, `init_escrow`, `release_escrow`,
 * `streamEvents`, indexer ingestion, and verification bundle endpoint).
 */
export function createConformanceHarness(options = {}) {
  const network = options.network ?? process.env.STELLAR_NETWORK ?? 'standalone';
  const simulated = options.simulated ?? false;
  let ledgerSeq = options.initialLedger ?? 1000;
  let eventSeq = 0;

  const anchoredShipments = new Map();
  const escrows = new Map();
  const eventLog = [];
  const indexedLedgerBlocks = new Map();
  let indexerCursor;

  function nextTxHash(seedPayload) {
    return computeCanonicalHash({ seedPayload, ledgerSeq, eventSeq });
  }

  return {
    /**
     * Scenario 1: scan -> anchored
     */
    async scanAndAnchor({ shipmentId, scanPayload, actor = DEFAULT_ACTOR_ADDRESS }) {
      const dataHash = computeCanonicalHash({
        shipmentId,
        ...scanPayload,
      });
      const input = {
        shipment_id: shipmentId,
        data_hash: dataHash,
        actor,
      };
      validateAnchorInput(input);

      if (anchoredShipments.has(shipmentId)) {
        const err = new Error('Shipment already anchored');
        err.code = 'ERR_CHAIN_ALREADY_ANCHORED';
        throw err;
      }

      ledgerSeq += 1;
      eventSeq += 1;
      const txHash = nextTxHash(input);
      const eventId = `${ String(ledgerSeq).padStart(10, '0') }-${ String(eventSeq).padStart(4, '0') }`;
      const closedAt = new Date().toISOString();

      const receipt = {
        txHash,
        ledger: ledgerSeq,
        simulated,
      };

      const record = {
        shipmentId,
        scanPayload,
        dataHash,
        actor,
        anchorStatus: 'ANCHORED',
        stellarTxHash: txHash,
        ledger: ledgerSeq,
        simulated,
        anchoredAt: closedAt,
      };
      anchoredShipments.set(shipmentId, record);

      const emittedEvent = validateChainEvent({
        id: eventId,
        contract_id: DEFAULT_CONTRACT_ID,
        tx_hash: txHash,
        ledger: ledgerSeq,
        ledger_closed_at: closedAt,
        name: 'anchor',
        topic: ['anchor', shipmentId],
        data: [dataHash, ledgerSeq],
      });
      eventLog.push(emittedEvent);

      return { receipt, record, emittedEvent };
    },

    /**
     * Initializes an escrow record for Scenario 2 & 3 testing.
     */
    async initEscrow({
      paymentId,
      shipmentId,
      payer = DEFAULT_ACTOR_ADDRESS,
      payee = DEFAULT_PAYEE_ADDRESS,
      token = DEFAULT_CONTRACT_ID,
      amount = '2500000000',
    }) {
      if (escrows.has(paymentId)) {
        const err = new Error('Escrow already exists');
        err.code = 'ERR_CHAIN_ESCROW_EXISTS';
        throw err;
      }

      ledgerSeq += 1;
      eventSeq += 1;
      const txHash = nextTxHash({ paymentId, shipmentId, amount });
      const eventId = `${ String(ledgerSeq).padStart(10, '0') }-${ String(eventSeq).padStart(4, '0') }`;
      const closedAt = new Date().toISOString();

      const escrow = {
        paymentId,
        shipmentId,
        payer,
        payee,
        token,
        amount,
        status: 'FUNDED',
        initTxHash: txHash,
        releaseTxHash: null,
        proofHash: null,
        ledger: ledgerSeq,
      };
      escrows.set(paymentId, escrow);

      const emittedEvent = validateChainEvent({
        id: eventId,
        contract_id: DEFAULT_CONTRACT_ID,
        tx_hash: txHash,
        ledger: ledgerSeq,
        ledger_closed_at: closedAt,
        name: 'esc_init',
        topic: ['esc_init', paymentId],
        data: [shipmentId, payer, payee, token, amount],
      });
      eventLog.push(emittedEvent);

      return { escrow, emittedEvent };
    },

    /**
     * Scenario 2: deliver -> escrow released
     */
    async deliverAndReleaseEscrow({ paymentId, shipmentId, deliveryProofUrl }) {
      const escrow = escrows.get(paymentId);
      if (!escrow) {
        const err = new Error('Escrow not found');
        err.code = 'ERR_CHAIN_ESCROW_NOT_FOUND';
        throw err;
      }
      if (escrow.status === 'RELEASED') {
        const err = new Error('Escrow already released');
        err.code = 'ERR_CHAIN_ESCROW_ALREADY_RELEASED';
        throw err;
      }

      const proofHash = computeCanonicalHash({
        shipmentId,
        paymentId,
        deliveryProofUrl: deliveryProofUrl ?? null,
      });

      const input = {
        payment_id: paymentId,
        proof_hash: proofHash,
      };
      validateReleaseEscrowInput(input);

      ledgerSeq += 1;
      eventSeq += 1;
      const txHash = nextTxHash(input);
      const eventId = `${ String(ledgerSeq).padStart(10, '0') }-${ String(eventSeq).padStart(4, '0') }`;
      const closedAt = new Date().toISOString();

      escrow.status = 'RELEASED';
      escrow.releaseTxHash = txHash;
      escrow.proofHash = proofHash;
      escrow.releasedLedger = ledgerSeq;

      const receipt = {
        txHash,
        ledger: ledgerSeq,
        simulated,
        paymentId,
      };

      const emittedEvent = validateChainEvent({
        id: eventId,
        contract_id: DEFAULT_CONTRACT_ID,
        tx_hash: txHash,
        ledger: ledgerSeq,
        ledger_closed_at: closedAt,
        name: 'esc_rel',
        topic: ['esc_rel', paymentId],
        data: [proofHash, escrow.payee, escrow.amount],
      });
      eventLog.push(emittedEvent);

      return { receipt, escrow, proofHash, emittedEvent };
    },

    /**
     * Streams contract events strictly after `cursor`.
     */
    async *streamEvents(cursor) {
      let seenCursor = !cursor;
      for (const evt of eventLog) {
        if (!seenCursor) {
          if (evt.id === cursor) {
            seenCursor = true;
          }
          continue;
        }
        yield validateChainEvent(evt);
      }
    },

    /**
     * Scenario 3: indexer ingests emitted event
     */
    async runIndexerCycle(initialCursor) {
      let cursor = initialCursor ?? indexerCursor;
      let processed = 0;
      let upserted = 0;

      for await (const event of this.streamEvents(cursor)) {
        processed += 1;
        cursor = event.id;

        let eventType;
        let shipmentId;
        const metadata = {
          blockNumber: event.ledger,
          ledger: event.ledger,
          contractId: event.contract_id,
          eventId: event.id,
        };

        if (event.name === 'anchor') {
          eventType = 'IN_TRANSIT';
          shipmentId = event.topic[1];
          metadata.dataHash = event.data[0];
        } else if (event.name === 'esc_init') {
          eventType = 'SETTLEMENT_INITIATED';
          shipmentId = event.data[0];
          metadata.paymentId = event.topic[1];
          metadata.payer = event.data[1];
          metadata.payee = event.data[2];
          metadata.token = event.data[3];
          metadata.amount = event.data[4];
        } else if (event.name === 'esc_rel') {
          eventType = 'SETTLEMENT_COMPLETED';
          shipmentId = event.topic[1];
          metadata.paymentId = event.topic[1];
          metadata.proofHash = event.data[0];
          metadata.payee = event.data[1];
          metadata.amount = event.data[2];
        }

        if (!indexedLedgerBlocks.has(event.tx_hash)) {
          indexedLedgerBlocks.set(event.tx_hash, {
            shipmentId,
            eventType,
            transactionHash: event.tx_hash,
            actor: 'stellar-indexer',
            metadata,
          });
          upserted += 1;
        } else {
          const existing = indexedLedgerBlocks.get(event.tx_hash);
          existing.metadata = metadata;
        }

        indexerCursor = cursor;
      }

      return {
        processed,
        upserted,
        lastCursor: cursor,
        blocks: Array.from(indexedLedgerBlocks.values()),
      };
    },

    /**
     * Scenario 4: frontend verifies badge via bundle endpoint
     */
    async getVerificationBundle(shipmentId, currentPayloadOverride) {
      const record = anchoredShipments.get(shipmentId);
      if (!record) {
        const err = new Error(`Shipment ${shipmentId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const effectivePayload = currentPayloadOverride ?? record.scanPayload;
      const recomputedHash = computeCanonicalHash({
        shipmentId,
        ...effectivePayload,
      });
      const hashesMatch = recomputedHash === record.dataHash;

      let badgeStatus = 'UNVERIFIED';
      if (hashesMatch) {
        badgeStatus = record.simulated ? 'SIMULATED_VERIFIED' : 'VERIFIED';
      } else {
        badgeStatus = 'MISMATCH';
      }

      return {
        specVersion: CHAIN_SPEC_VERSION,
        shipmentId,
        verified: hashesMatch,
        simulated: record.simulated,
        network,
        badgeStatus,
        onChainHash: record.dataHash,
        recomputedHash,
        txHash: record.stellarTxHash,
        ledger: record.ledger,
        contractId: DEFAULT_CONTRACT_ID,
        explorerUrl: `https://stellar.expert/explorer/${network === 'public' ? 'public' : 'testnet'}/tx/${record.stellarTxHash}`,
      };
    },
  };
}
