import { Telemetry } from './telemetry.model.js';
import { TelemetryAnchorStatus } from '../../shared/types/telemetry.js';

/** A record is VERIFIED once its anchoring ledger has at least this many ledgers on top of it (#818). */
export const MIN_CONFIRMATION_LEDGERS = 3;

/** Read-only ledger queries needed for confirmation tracking. */
export interface LedgerLookup {
  getLatestLedger(): Promise<number>;
  getTransactionLedger(txHash: string): Promise<number | null>;
}

export interface TelemetryConfirmationSummary {
  /** Anchored records examined in this run. */
  checked: number;
  /** Records flipped to VERIFIED in this run. */
  verified: number;
  /** Records still awaiting depth (or whose transaction is not yet found). */
  pending: number;
  /** Records whose ledger lookup or update failed; they are retried next run. */
  errors: number;
}

/**
 * Number of ledgers including the transaction's own ledger.
 * A transaction in the latest ledger has depth 1. Returns 0 when the
 * transaction is ahead of the reported latest ledger.
 */
export function ledgerDepth(latestLedger: number, txLedger: number): number {
  return latestLedger >= txLedger ? latestLedger - txLedger + 1 : 0;
}

/**
 * Confirmation tracking for anchored telemetry (#818).
 *
 * Finds ANCHORED telemetry with a stellarTxHash, checks the ledger depth of
 * each anchoring transaction, and flips records with depth >= minDepth to
 * VERIFIED (`verified: true`). Idempotent: the update is conditional on the
 * record still being ANCHORED, so repeated runs do not double-count.
 *
 * Per-record lookup failures are counted and skipped so one bad hash cannot
 * block the rest of the batch. A failure to read the latest ledger throws.
 */
export async function confirmAnchoredTelemetry(
  lookup: LedgerLookup,
  options: { limit?: number; minDepth?: number } = {}
): Promise<TelemetryConfirmationSummary> {
  const limit = options.limit ?? 200;
  const minDepth = options.minDepth ?? MIN_CONFIRMATION_LEDGERS;
  const summary: TelemetryConfirmationSummary = { checked: 0, verified: 0, pending: 0, errors: 0 };

  const candidates = (await Telemetry.find({
    anchorStatus: TelemetryAnchorStatus.ANCHORED,
    stellarTxHash: { $nin: [null, ''] },
    deletedAt: null,
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .select('_id stellarTxHash')
    .lean()) as unknown as Array<{ _id: unknown; stellarTxHash: string }>;

  if (candidates.length === 0) return summary;

  const latest = await lookup.getLatestLedger();

  for (const doc of candidates) {
    summary.checked += 1;
    try {
      const txLedger = await lookup.getTransactionLedger(doc.stellarTxHash);
      if (txLedger === null) {
        summary.pending += 1;
        continue;
      }

      const depth = ledgerDepth(latest, txLedger);
      if (depth < minDepth) {
        summary.pending += 1;
        continue;
      }

      const result = await Telemetry.updateOne(
        { _id: doc._id, anchorStatus: TelemetryAnchorStatus.ANCHORED },
        {
          $set: {
            anchorStatus: TelemetryAnchorStatus.VERIFIED,
            verified: true,
            confirmationMetadata: {
              ledger: txLedger,
              confirmations: depth,
              verified: true,
              indexedAt: new Date().toISOString(),
            },
          },
        }
      );
      if (result.modifiedCount === 1) {
        summary.verified += 1;
      }
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}
