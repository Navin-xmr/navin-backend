# Chain Alerts Runbook (P15-12)

Alert rules for the Stellar / Soroban chain integration. Rules are defined in
`src/services/chain-alerts.ts` and tested in `tests/chain-alerts.test.ts`.
Each rule is a pure function that returns an `AlertPayload` when its threshold
is breached; the caller enqueues the payload via `dispatchAlert` (see
`src/services/queue.service.ts`) so the alert worker can process it.

All thresholds are exported constants in `src/services/chain-alerts.ts` and can
be tuned without code changes to the rule logic.

## Alert rules

| #   | Alert                                     | Type                            | Severity | Threshold                  | Owner                   | Runbook                                          |
| --- | ----------------------------------------- | ------------------------------- | -------- | -------------------------- | ----------------------- | ------------------------------------------------ |
| 1   | Repeated submission failures              | `CHAIN_SUBMISSION_FAILURES`     | high     | ≥ 3 failures in 5 min      | Platform Team           | `docs/runbooks/chain-submission-failures.md`     |
| 2   | Unknown contract error codes (spec drift) | `CHAIN_SPEC_DRIFT`              | critical | 1 occurrence               | Platform Team           | `docs/runbooks/chain-spec-drift.md`              |
| 3   | Indexer cursor stalled                    | `CHAIN_INDEXER_STALLED`         | high     | cursor unchanged ≥ 10 min  | Platform Team           | `docs/runbooks/chain-indexer-stalled.md`         |
| 4   | Reconciliation mismatch                   | `CHAIN_RECONCILIATION_MISMATCH` | critical | 1 mismatch                 | Platform Team / Finance | `docs/runbooks/chain-reconciliation-mismatch.md` |
| 5   | Low channel-account balance               | `CHAIN_LOW_BALANCE`             | medium   | < 1,000 XLM native balance | Platform Team           | `docs/runbooks/chain-low-balance.md`             |
| 6   | Dead-letter growth                        | `CHAIN_DEAD_LETTER_GROWTH`      | high     | ≥ 10 failed jobs           | Platform Team           | `docs/runbooks/chain-dead-letter-growth.md`      |

## 1. Chain submission failures — `CHAIN_SUBMISSION_FAILURES`

**Trigger:** `checkSubmissionFailures(failureCount, windowMin)` returns an alert
when `failureCount >= SUBMISSION_FAILURE_THRESHOLD` (3) within
`SUBMISSION_FAILURE_WINDOW_MIN` (5 minutes).

**Runbook:** `docs/runbooks/chain-submission-failures.md`

**Triage:**

1. Inspect `transaction_queue` failed jobs and the Stellar worker logs
   (`src/workers/stellar.worker.ts`).
2. Confirm the signing account (`STELLAR_SECRET_KEY`) is funded and has a valid
   sequence number.
3. Confirm Horizon / Soroban RPC reachability (`config.horizonUrl`,
   `config.sorobanRpcUrl`).
4. If failures are transient, let the worker's exponential backoff retry; if
   persistent, page the Platform Team.

## 2. Unknown contract error codes (spec drift) — `CHAIN_SPEC_DRIFT`

**Trigger:** `checkUnknownContractError(contractCode, functionName)` returns an
alert when the raw u32 contract error discriminant is not in
`CHAIN_CONTRACT_ERRORS` (codes 1–8) in `src/shared/types/chain.ts`.

**Runbook:** `docs/runbooks/chain-spec-drift.md`

**Triage:**

1. Identify the unknown code and the emitting contract function.
2. Compare against the contracts repo (`Navin-xmr/navin-contracts`) ABI.
3. If the contract added a new error, add it to `CHAIN_CONTRACT_ERRORS`,
   `CHAIN_ERROR_MAP`, and `ErrorCodes` in `src/shared/types/chain.ts`, bump
   `CHAIN_SPEC_VERSION`, and update `docs/chain-interface.md` + golden fixtures
   in the same PR (AGENTS §8 drift rule).
4. Never silently swallow unknown codes — they map to `ERR_CHAIN_UNKNOWN` (502).

## 3. Indexer cursor stalled — `CHAIN_INDEXER_STALLED`

**Trigger:** `checkIndexerCursorStalled(lastCursorAt, now)` returns an alert
when the `IndexerState` cursor has not advanced for
`INDEXER_STALLED_THRESHOLD_MIN` (10 minutes).

**Runbook:** `docs/runbooks/chain-indexer-stalled.md`

**Triage:**

1. Confirm the `stellar-indexer` worker is running (`docker compose ps`).
2. Check the indexer job logs for `Stellar indexer job failed`.
3. Confirm Redis (`getBullMQConnection`) and Mongo (`connectMongo`) are healthy.
4. Confirm the `ChainAdapter.streamEvents()` cursor resume position is valid.
5. Manually re-run `indexStellarTransactions()` from the last known cursor.

## 4. Reconciliation mismatch — `CHAIN_RECONCILIATION_MISMATCH`

**Trigger:** `checkReconciliationMismatch(alert)` forwards an
`ESCROW_AMOUNT_MISMATCH` produced by `reconcileEscrowEvent` (P13-12) when the
on-chain escrow amount (stroops) disagrees with the payment record amount.

**Runbook:** `docs/runbooks/chain-reconciliation-mismatch.md`

**Triage:**

1. Do **not** overwrite the DB — the mismatch alert deliberately performs no
   write (see `applyReconciliation`).
2. Compare `chainAmountStroops` vs `dbAmountStroops` in the alert payload.
3. Confirm the payment's `amount` (7-decimal XLM) matches the chain event's
   `amount` field converted via `stroopsTo7Decimal()`.
4. If the chain is correct, correct the DB off-cycle with a finance-approved
   migration; if the chain event is wrong, investigate the emitting contract.

## 5. Low channel-account balance — `CHAIN_LOW_BALANCE`

**Trigger:** `checkChannelLowBalance(balanceStroops)` returns an alert when the
channel (signing) account native balance is below
`CHANNEL_LOW_BALANCE_THRESHOLD_STROOPS` (1,000 XLM = 10⁷ × 1000 stroops).

**Runbook:** `docs/runbooks/chain-low-balance.md`

**Triage:**

1. Query the channel account balance via Horizon (`/accounts/{publicKey}`) or
   Soroban RPC `getAccount`.
2. If below threshold, fund the channel account (`STELLAR_SECRET_KEY`'s public
   key) from the treasury.
3. Re-check before the next escrow / release operation — low balance causes
   submission failures (alert #1).

## 6. Dead-letter growth — `CHAIN_DEAD_LETTER_GROWTH`

**Trigger:** `checkDeadLetterGrowth(failedJobCount)` returns an alert when the
number of failed / dead-letter BullMQ jobs is ≥ `DEAD_LETTER_THRESHOLD` (10).

**Runbook:** `docs/runbooks/chain-dead-letter-growth.md`

**Triage:**

1. Inspect `transaction_queue` and `alert_queue` failed jobs via BullMQ.
2. Identify the recurring failure cause from job `failedReason` / stack.
3. Clear or retry dead-letter jobs only after the root cause is fixed.
4. If growth continues, scale the worker (`docker compose up --scale
stellar-worker=2`) or increase concurrency.

## Testing

Each alert rule is covered by a fixture test in
`tests/chain-alerts.test.ts` (12 tests: fire / no-fire per rule plus registry
metadata). Run:

```bash
npm test -- tests/chain-alerts.test.ts
```

Alert-fire evidence is captured by asserting the returned `AlertPayload`
`type`, `message`, and `shipmentId` match the expected breach condition.

## Dependencies

- P13-12 — escrow reconciliation (reconciliation mismatch alert reuses
  `reconcileEscrowEvent` output).
- P13-16 / P13-17 / P15-11 — chain worker, indexer, and queue infrastructure
  that feed the submission-failure, indexer-stalled, and dead-letter signals.
