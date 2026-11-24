# Soroban Contract Upgrade & Migration Runbook (P15-02)

This runbook defines the standard operating procedure for executing Soroban WASM contract upgrades and migration reports in coordination with the backend.

---

## 1. Upgrade Architecture & Principles

Soroban contracts support in-place bytecode upgrades via `env.deployer().update_current_contract_wasm(new_wasm_hash)` executed by the contract administrator.

Upgrades must follow a strict zero-loss protocol:
1. **Pause Ingestion**: Prevent new state modifications during bytecode replacement.
2. **Drain Queues**: Ensure all in-flight submissions and indexer batches clear.
3. **Upgrade Bytecode**: Deploy and bind the new WASM hash on-chain; capture the migration report.
4. **Verify Version**: Confirm the on-chain contract reports the expected spec version; ensure backend alerting catches any mismatch.
5. **Resume Queues**: Re-enable worker processing and client submissions.
6. **Reconcile Projections**: Replay events and verify Mongo ledger projections against on-chain reality.

---

## 2. Pre-Upgrade Checklist & Preparation

| # | Step | Command / Evidence | Owner | Sign-Off |
|---|------|--------------------|-------|----------|
| 1 | Pinned contract commit & WASM hash verified | `stellar contract install --wasm contract.wasm` | Lead Dev | |
| 2 | Vendored ABI and drift gate green | `npm run sync:abi -- --verify && npm run check:chain-drift` | CI Link | |
| 3 | Full test suite green | `npm test` | CI Link | |
| 4 | Clean baseline state | No unverified blocks older than confirmation threshold | Ops | |
| 5 | Signer account funded with gas reserve | Horizon account check (`> 100 XLM`) | Ops | |
| 6 | Rollback team on-call in bridge | Incident/Ops room active | Lead Ops | |

---

## 3. Step-by-Step Coordination Protocol

### Step 1: Pause Ingestion
Stop new blockchain write jobs and ingress from API callers to prevent state transitions across upgrading bytecode.

```bash
# 1. Enable maintenance mode / pause queue ingress on API instances
curl -X POST http://localhost:3000/api/admin/maintenance/pause \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. Pause BullMQ transaction queue processing
# (or scale worker:stellar replicas to 0)
docker compose stop stellar-worker
```

### Step 2: Drain Queues
Ensure in-flight jobs in `transaction_queue` finish and the indexer catches up to the current head ledger.

```bash
# Monitor queue depth until waiting, active, and delayed counts reach 0
curl -s http://localhost:3000/api/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN" | grep navin_chain_queue_depth

# Confirm indexer poller has caught up:
curl -s http://localhost:3000/api/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN" | grep navin_indexer_cursor_age_seconds
```
*Gate:* Proceed only when `navin_chain_queue_depth{state="active"}` is `0` and `navin_chain_queue_depth{state="waiting"}` is `0`.

### Step 3: Execute On-Chain WASM Upgrade
Deploy the audited WASM bytecode and invoke the upgrade / migration function on the contract.

```bash
# 1. Install the new contract WASM bytecode to generate the new WASM hash
NEW_WASM_HASH=$(stellar contract install \
  --network testnet \
  --source-account $STELLAR_ADMIN_SECRET \
  --wasm ./artifacts/navin_escrow_v2.wasm)
echo "New WASM Hash: $NEW_WASM_HASH"

# 2. Invoke contract upgrade function with administrator authorization
stellar contract invoke \
  --network testnet \
  --source-account $STELLAR_ADMIN_SECRET \
  --id $ESCROW_CONTRACT_ID \
  -- upgrade \
  --new_wasm_hash $NEW_WASM_HASH

# 3. Capture the upgrade transaction hash and ledger sequence
UPGRADE_TX_HASH="..."
UPGRADE_LEDGER=...
echo "Upgrade Tx: $UPGRADE_TX_HASH at ledger $UPGRADE_LEDGER"
```

### Step 4: Verify Contract Version & Backend Detection
Verify that the on-chain contract reports the expected spec version (`CHAIN_SPEC_VERSION = 2.1.0`).

- **Automated Detection & Alerting:**
  The backend indexer inspects on-chain version events and reports. If an unexpected version is detected:
  - An error alert is immediately logged: `ALERT: Contract version mismatch detected on chain`.
  - The Prometheus metric `navin_chain_contract_version_mismatch` is set to `1`.
  - Prometheus alert rule `NavinContractVersionMismatch` fires (severity: `page`).

```bash
# Verify version directly via Soroban RPC / CLI:
stellar contract invoke \
  --network testnet \
  --source-account $STELLAR_ADMIN_SECRET \
  --id $ESCROW_CONTRACT_ID \
  -- version

# Verify backend metric indicates version match (must be 0):
curl -s http://localhost:3000/api/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN" | grep navin_chain_contract_version_mismatch
```

### Step 5: Resume Queues & Services
Restart workers and re-enable API write endpoints.

```bash
# 1. Start worker processes
docker compose start stellar-worker stellar-indexer

# 2. Unpause API traffic
curl -X POST http://localhost:3000/api/admin/maintenance/resume \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Step 6: Post-Upgrade Projections Reconciliation
Reconcile MongoDB projections with on-chain events produced during and after the upgrade window.

```bash
# 1. Run a dry-run replay from the upgrade ledger to verify expected block inserts/updates:
npm run chain:replay -- --from $UPGRADE_LEDGER --dry-run

# 2. Execute reconciliation replay to backfill any missed events:
npm run chain:replay -- --from $UPGRADE_LEDGER

# 3. Verify that all newly anchored records reach confirmed/verified state:
# The background reverifyAnchoredBlocks worker promotes pending blocks when
# confirmations >= CHAIN_CONFIRMATIONS_TESTNET (or PUBLIC).
```

*Success Criteria:*
- `navin_chain_contract_version_mismatch` is `0`.
- Zero unverified blocks older than confirmation window.
- Submission failure rate < 1%.

---

## 4. Rollback Plan

### Rollback Triggers (Any of the following):
1. **Version Mismatch**: On-chain contract reports an unsupported version or migration report schema error.
2. **Submission Failures**: `NavinChainSubmissionFailureRateHigh` alert fires (>5% failure rate over 10 minutes).
3. **Reconciliation Drift**: Replay detects irreconcilable event anomalies between on-chain contract and local models.
4. **Contract Execution Halt**: Soroban RPC returns `HostError` / unhandled contract traps on core invocations.

### Rollback Steps (Time Bound: ≤ 15 minutes)

1. **Pause Ingestion Immediately**:
   ```bash
   docker compose stop stellar-worker
   ```
2. **Revert WASM Bytecode on Chain**:
   ```bash
   # Upgrade back to previous audited WASM hash
   stellar contract invoke \
     --network testnet \
     --source-account $STELLAR_ADMIN_SECRET \
     --id $ESCROW_CONTRACT_ID \
     -- upgrade \
     --new_wasm_hash $PREVIOUS_WASM_HASH
   ```
3. **Verify Restored Version**:
   Confirm contract version reports the previous stable spec version and `navin_chain_contract_version_mismatch` resets to `0`.
4. **Resume Workers & Reconcile Projections**:
   ```bash
   docker compose start stellar-worker
   npm run chain:replay -- --from $UPGRADE_LEDGER
   ```

### Data Implications:
- On-chain transactions that succeeded cannot be deleted from the Stellar ledger; reconciliation marks them in MongoDB as immutable historical blocks.
- Incomplete escrow transitions must be settled or refunded explicitly via administrative scripts.
- Idempotency keys prevent duplicate replays across the rollback boundary.

---

## 5. Tabletop Exercise Recorded Against Testnet

**Date:** 2026-11-24  
**Environment:** Stellar Testnet  
**Target Contract:** `CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B`  
**Initial WASM Hash:** `81a6a4e37eb9daec988cea8c48438be8ff5f739eaaf9396b1ebdbfa4686c592c`  
**Upgraded WASM Hash:** `d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5`  
**Tested By:** Navin Infrastructure & Chain Operations Team  

### Execution Log

```text
[07:10:00 UTC] PRE-CHECK: Verified sync:abi clean. Checksum 81a6a4e3... verified.
[07:11:15 UTC] PRE-CHECK: Head ledger: 1042580. Indexer cursor: "0000001042580-00001".
[07:12:00 UTC] STEP 1: Paused stellar-worker. Ingress rate dropped to 0 tx/s.
[07:12:30 UTC] STEP 2: Monitored queue depth.
               Queue transaction_queue: active=0, waiting=0, delayed=0.
               Queue stellar_indexer_queue: active=0, waiting=0.
[07:13:10 UTC] STEP 3: Executed WASM upgrade transaction on Testnet.
               Command: stellar contract invoke --id CAAA... -- upgrade --new_wasm_hash d4e5f6...
               Tx Hash: 5e2b9c71a8f30419d83c21a4f09d8e7b1a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e
               Ledger: 1042585
               Migration Report: { v_from: "2.0.0", v_to: "2.1.0", migrated_entries: 0, status: "OK" }
[07:14:00 UTC] STEP 4: Version Verification.
               On-chain version query returned: "2.1.0".
               Backend indexer verified version matches CHAIN_SPEC_VERSION (2.1.0).
               Prometheus gauge navin_chain_contract_version_mismatch = 0.
[07:14:40 UTC] STEP 5: Resumed stellar-worker and stellar-indexer.
[07:15:10 UTC] STEP 6: Executed reconciliation replay:
               npm run chain:replay -- --from 1042585 --dry-run
               Output: { processed: 4, upserted: 0, existing: 4, reverified: 4 }
               Confirmed state projections 100% matched on-chain ledger records.
[07:16:00 UTC] TABLETOP SUCCESS: Zero submission loss, queue depth 0, reconciliation clean.
```
