# Soroban cutover checklist and rollback plan

Final gate before setting `SOROBAN_ADAPTER=soroban` in production (default is `simulated`).
Every item needs an owner sign-off and a link to evidence in the cutover PR/ticket before the switch.

## 1. Go / no-go checklist

| #   | Gate                                                                                                                                                                    | Evidence             | Owner | Sign-off (name · date) |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----- | ---------------------- |
| 1   | Conformance suite green on `main` (`npm test`, `npm run test:chain:schemas`)                                                                                            | CI run link          |       |                        |
| 2   | Drift gate green (`npm run check:chain-drift`: ABI checksum, `CHAIN_SPEC_VERSION` ↔ fixtures, `chain.ts` ↔ ABI)                                                         | CI run link          |       |                        |
| 3   | Load test evidence at expected peak (anchor/escrow submissions, zero sequence failures)                                                                                 | Report link          |       |                        |
| 4   | Alerts live and test-fired: chain submission failures, indexer lag, RPC errors, confirmation backlog                                                                    | Alert screenshots    |       |                        |
| 5   | Keys rotated: `STELLAR_SECRET_KEY` is a fresh production key, funded; old key revoked                                                                                   | Rotation ticket      |       |                        |
| 6   | `SOROBAN_RPC_URL` and `ESCROW_CONTRACT_ID` point at the audited production contract; `CHAIN_CONFIRMATIONS_PUBLIC` set                                                   | Env diff             |       |                        |
| 7   | Reconciliation clean: no unverified `LedgerBlock` older than the confirmation window; `npm run chain:replay -- --from <ledger> --dry-run` reports no unexpected inserts | Command output       |       |                        |
| 8   | Idempotency in place: clients send `Idempotency-Key` on shipment create/status and payment create/status                                                                | Client release notes |       |                        |
| 9   | Rollback rehearsed on staging (section 3)                                                                                                                               | Rehearsal log        |       |                        |
| 10  | On-call briefed; cutover window and comms scheduled                                                                                                                     | Calendar link        |       |                        |

## 2. Cutover steps

1. Note the current head ledger and indexer cursor (`IndexerState` key `stellar_indexer`).
2. Deploy with `SOROBAN_ADAPTER=soroban`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID`.
3. Restart the API and the `worker:stellar` / `worker:stellar-indexer` processes.
4. Smoke test: create one shipment, anchor it, init and release escrow on a low-value shipment; confirm the events are indexed and reach `verified`.
5. Start the monitoring window (section 4).

## 3. Rollback plan

**Trigger (any of):** submission failure rate above 5% for 10 minutes, indexer lag over 15 minutes, a reconciliation mismatch, or an ABI/contract fault.

| Step | Action                                                                                                                                                         | Time bound             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | Set `SOROBAN_ADAPTER=simulated` and redeploy API + workers                                                                                                     | ≤ 15 min from decision |
| 2    | Confirm new chain submissions return `simulated: true` and stop hitting the RPC                                                                                | ≤ 5 min after deploy   |
| 3    | Run `npm run chain:replay -- --from <cutover ledger> --dry-run`, then without `--dry-run` if counts look right, to rebuild the projection from on-chain events | ≤ 30 min               |
| 4    | Re-run the reconciliation check (checklist item 7) and record the outcome                                                                                      | ≤ 1 h                  |

**Data implications**

- On-chain transactions are not reversible. Anchors and escrows created on Soroban remain on-chain after rollback; the backend keeps those `LedgerBlock` rows.
- Work done while on `simulated` has no on-chain counterpart (`simulated: true`). After a later re-cutover, re-anchor it if it needs on-chain proof.
- Escrows initialised on-chain but not released must be released on-chain or reconciled by hand. Don't re-init them while on `simulated`.
- Replay is idempotent (upserts by transaction hash) and does not move the live indexer cursor, so it can be repeated safely.
- Idempotency records expire after 24 h; retried requests after rollback within that window replay the original response.

## 4. Post-cutover monitoring window

- **Duration:** 72 hours, with on-call watching the first 4 hours continuously.
- **Watch:** chain submission success rate, indexer lag, unverified-block backlog, RPC error rate, signing account balance.
- **Exit:** window ends with no rollback trigger hit and a clean reconciliation at 24 h and 72 h. Record the sign-off here:

| Milestone            | Result | Sign-off (name · date) |
| -------------------- | ------ | ---------------------- |
| +4 h                 |        |                        |
| +24 h reconciliation |        |                        |
| +72 h exit           |        |                        |

## 5. Staging dry run

Run sections 2 and 3 end to end on staging, including one executed rollback, and attach the log to checklist item 9.
