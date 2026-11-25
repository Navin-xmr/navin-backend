# Chain Adapter Interface Specification (shipment contract)

**Status:** v2.2 (`CHAIN_SPEC_VERSION = 2.2.0`); ABI-verified — frontend verification v2 is defined in §7.

This is the normative v2 surface of the deployed **Navin Shipment** Soroban contract (v1 closed #649; v2 evolves the escrow signature and event verification per #1056 / #1058, adds the dispute lifecycle per #1053, and delivery events per #1043). Authoritative upstream sources:

- Function/argument/return table: [contract-schema.shipment.json](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/contract-schema.shipment.json) (vendored at `contracts/abi/contract-schema.shipment.json`)
- Event topics: `contracts/shipment/src/event_topics.rs`; payloads: `contracts/shipment/src/events.rs` and `docs/events.md`
- Errors: `contracts/shipment/src/errors.rs` (discriminants verbatim below)
- Single source of truth for shapes: `src/shared/types/chain.ts`. Cross-repo golden vectors: `tests/fixtures/chain/{functions,events,errors}.json` (`spec_version = 2.2.0`). Contracts repo: [Navin-xmr/navin-contracts](https://github.com/Navin-xmr/navin-contracts). For the client-side trustless flow that consumes the verification bundle, see [chain-verification.md](chain-verification.md).

> **Drift rule (AGENTS.md §8):** doc ↔ `src/shared/types/chain.ts` (+ `CHAIN_SPEC_VERSION`) ↔ `tests/fixtures/chain/*.json` must change together. `npm run check:chain-interface` verifies that every function in the table below exists in the vendored schema JSON (zero mismatches).

## Changelog from v1 (DRAFT v0)

- Replaced the imaginary v0 surface (`initialize`, `confirm_milestone`, `release`) with all 125 functions from the real shipment ABI, including `create_shipment`, `deposit_escrow`, `update_status`, `confirm_delivery`, `release_escrow`, reads and governance.
- Event tuples now carry `schema_version` (2), `event_counter` and `idempotency_key` for dedupe/replay protection.
- Error table now uses the contract's real `NavinError` discriminants (v1 listed invented codes).
- Contract sign-off: **PENDING** — a contracts-repo maintainer acknowledgement must be linked here before this spec can be considered frozen (P6-01 acceptance criterion).

## 1. Functions (125)

Types: `address` = Stellar strkey, `u64` = shipment id, `i128` = token amount (smallest units), `BytesN<32>` = SHA-256 hex, `symbol` = short contract symbol. All state-changing functions require authorization of the address named in the rustdoc/source; the auth column is derived from the ABI rustdoc. Result type is `Result<T, NavinError>`.

| Function | Args (positional order) | Returns (ok type) | Auth |
| --- | --- | --- | --- |
| `pause` | admin: address | `()` | Only the admin can pause the contract. |
| `unpause` | admin: address | `()` | Only the admin can unpause the contract. |
| `upgrade` | admin: address, new_wasm_hash: BytesN<32>, target_version: u32 | `()` | Only the admin can trigger upgrades. |
| `get_role` | address: address | `Role` | See rustdoc (argument-based authorization) |
| `get_admin` | — | `address` | See rustdoc (argument-based authorization) |
| `is_paused` | — | `bool` | Read-only function, no authentication required. |
| `initialize` | admin: address, token_contract: address | `()` | See rustdoc (argument-based authorization) |
| `update_eta` | carrier: address, shipment_id: u64, eta_timestamp: u64, data_hash: BytesN<32> | `()` | Only the designated registered carrier can update ETA. |
| `add_carrier` | admin: address, carrier: address | `()` | See rustdoc (argument-based authorization) |
| `add_company` | admin: address, company: address | `()` | See rustdoc (argument-based authorization) |
| `get_version` | — | `u32` | See rustdoc (argument-based authorization) |
| `revoke_role` | admin: address, target: address | `()` | Only the admin can revoke roles. |
| `add_guardian` | admin: address, guardian: address | `()` | See rustdoc (argument-based authorization) |
| `add_operator` | admin: address, operator: address | `()` | See rustdoc (argument-based authorization) |
| `get_proposal` | proposal_id: u64 | `Proposal` | See rustdoc (argument-based authorization) |
| `get_shipment` | shipment_id: u64 | `Shipment` | See rustdoc (argument-based authorization) |
| `suspend_role` | admin: address, target: address | `()` | Only the admin can suspend roles. |
| `get_analytics` | — | `Analytics` | See rustdoc (argument-based authorization) |
| `init_multisig` | admin: address, admins: Vec<address>, threshold: u32 | `()` | Only the current admin can call this. |
| `raise_dispute` | caller: address, shipment_id: u64, reason_hash: BytesN<32> | `()` | Only the sender, receiver, or carrier can raise a dispute. |
| `refund_escrow` | caller: address, shipment_id: u64 | `()` | Only the sender (Company) or admin can trigger refund. |
| `update_config` | admin: address, new_config: ContractConfig | `()` | Only the admin can update the configuration. |
| `update_status` | caller: address, shipment_id: u64, new_status: ShipmentStatus, data_hash: BytesN<32> | `()` | Only the carrier or admin can update the status. |
| `approve_action` | approver: address, proposal_id: u64 | `()` | Only admins in the admin list can approve. |
| `check_deadline` | shipment_id: u64 | `()` | See rustdoc (argument-based authorization) |
| `deposit_escrow` | from: address, shipment_id: u64, amount: i128 | `()` | Only a Company can deposit, and the shipment must be in Created status. |
| `get_error_info` | code: u32 | `()` | See rustdoc (argument-based authorization) |
| `get_settlement` | settlement_id: u64 | `SettlementRecord` | See rustdoc (argument-based authorization) |
| `propose_action` | proposer: address, action: AdminAction | `u64` | Only admins in the admin list can propose actions. |
| `release_escrow` | caller: address, shipment_id: u64 | `()` | Only the receiver or admin can trigger release. |
| `transfer_admin` | admin: address, new_admin: address | `()` | Only the current admin can call this. |
| `cancel_shipment` | caller: address, shipment_id: u64, reason_hash: BytesN<32> | `()` | Only the Company (sender) or Admin can cancel. |
| `create_shipment` | sender: address, receiver: address, carrier: address, data_hash: BytesN<32>, payment_milestones: Vec<(symbol, u32)>, deadline: u64 | `u64` | See rustdoc (argument-based authorization) |
| `get_event_count` | shipment_id: u64 | `u32` | See rustdoc (argument-based authorization) |
| `get_status_hash` | shipment_id: u64, status: ShipmentStatus, visit_index: u32 | `StatusHashRecord` | See rustdoc (argument-based authorization) |
| `reactivate_role` | admin: address, target: address | `()` | Only the admin can reactivate roles. |
| `remove_guardian` | admin: address, guardian: address | `()` | See rustdoc (argument-based authorization) |
| `remove_operator` | admin: address, operator: address | `()` | See rustdoc (argument-based authorization) |
| `resolve_dispute` | admin: address, shipment_id: u64, resolution: DisputeResolution, reason_hash: BytesN<32> | `()` | Only the admin can call this. |
| `suspend_carrier` | admin: address, carrier: address | `()` | Only the admin can call this function. |
| `suspend_company` | admin: address, company: address | `()` | See rustdoc (argument-based authorization) |
| `archive_shipment` | admin: address, shipment_id: u64 | `()` | Only admin can archive, and shipment must be in a terminal state (Delivered or Cancelled). |
| `assert_data_hash` | shipment_id: u64, status: ShipmentStatus, visit_index: u32, expected_hash: BytesN<32> | `()` | See rustdoc (argument-based authorization) |
| `confirm_delivery` | receiver: address, shipment_id: u64, confirmation_hash: BytesN<32> | `()` | Only the designated receiver can call this function. |
| `execute_proposal` | proposal_id: u64 | `()` | See rustdoc (argument-based authorization) |
| `handoff_shipment` | current_carrier: address, new_carrier: address, shipment_id: u64, handoff_hash: BytesN<32> | `()` | Only the current assigned carrier can initiate the handoff. |
| `record_milestone` | carrier: address, shipment_id: u64, checkpoint: symbol, data_hash: BytesN<32> | `()` | Only registered carriers can record milestones. |
| `set_platform_fee` | admin: address, fee_bps: u32, treasury: address | `()` | Only Admin can execute. |
| `verify_data_hash` | shipment_id: u64, status: ShipmentStatus, visit_index: u32, expected_hash: BytesN<32> | `bool` | See rustdoc (argument-based authorization) |
| `dry_run_migration` | target_version: u32 | `MigrationReport` | See rustdoc (argument-based authorization) |
| `cleanup_audit_logs` | admin: address, before_timestamp: u64 | `u32` | See rustdoc (argument-based authorization) |
| `get_canonical_hash` | fields: Vec<val> | `()` | See rustdoc (argument-based authorization) |
| `get_escrow_balance` | shipment_id: u64 | `i128` | See rustdoc (argument-based authorization) |
| `get_shipment_count` | — | `()` | See rustdoc (argument-based authorization) |
| `get_shipment_limit` | — | `u32` | See rustdoc (argument-based authorization) |
| `get_status_summary` | — | `ShipmentStatusSummary` | See rustdoc (argument-based authorization) |
| `reactivate_carrier` | admin: address, carrier: address | `()` | Only the admin can call this function. |
| `reactivate_company` | admin: address, company: address | `()` | See rustdoc (argument-based authorization) |
| `set_creation_quota` | admin: address, max_per_window: u32, window_seconds: u64 | `()` | Only the admin can call this. |
| `set_shipment_limit` | admin: address, limit: u32 | `()` | Only the admin can call this. |
| `extend_shipment_ttl` | shipment_id: u64 | `()` | See rustdoc (argument-based authorization) |
| `get_config_checksum` | — | `BytesN<32>` | See rustdoc (argument-based authorization) |
| `get_contract_config` | — | `ContractConfig` | See rustdoc (argument-based authorization) |
| `get_multisig_config` | — | `(Vec<address>, u32)` | See rustdoc (argument-based authorization) |
| `get_shipments_batch` | shipment_ids: Vec<u64> | `Vec<{"option":{"value_type":{"udt":{"name":"Shipment"}}}}>` | See rustdoc (argument-based authorization) |
| `get_shipment_sender` | shipment_id: u64 | `address` | See rustdoc (argument-based authorization) |
| `get_shipment_status` | shipment_id: u64 | `ShipmentStatus` | See rustdoc (argument-based authorization) |
| `query_audit_history` | start_time: u64, end_time: u64 | `Vec<AuditLogEntry>` | See rustdoc (argument-based authorization) |
| `add_dispute_evidence` | caller: address, shipment_id: u64, evidence_hash: BytesN<32> | `u32` | See rustdoc (argument-based authorization) |
| `assert_delivery_hash` | shipment_id: u64, proof_hash: BytesN<32> | `()` | See rustdoc (argument-based authorization) |
| `get_dispute_evidence` | shipment_id: u64, index: u32 | `BytesN<32>` | See rustdoc (argument-based authorization) |
| `get_settlement_count` | — | `()` | See rustdoc (argument-based authorization) |
| `get_shipment_carrier` | shipment_id: u64 | `address` | See rustdoc (argument-based authorization) |
| `get_shipment_counter` | — | `u64` | See rustdoc (argument-based authorization) |
| `get_shipment_creator` | shipment_id: u64 | `address` | See rustdoc (argument-based authorization) |
| `is_carrier_suspended` | carrier: address | `bool` | See rustdoc (argument-based authorization) |
| `is_company_suspended` | company: address | `bool` | See rustdoc (argument-based authorization) |
| `accept_admin_transfer` | new_admin: address | `()` | Only the proposed admin can call this. |
| `force_cancel_shipment` | admin: address, shipment_id: u64, reason_hash: BytesN<32> | `()` | See rustdoc (argument-based authorization) |
| `get_active_settlement` | shipment_id: u64 | `{"option":{"value_type":"u64"}}` | See rustdoc (argument-based authorization) |
| `get_contract_metadata` | — | `ContractMetadata` | See rustdoc (argument-based authorization) |
| `get_hash_algo_version` | — | `u32` | See rustdoc (argument-based authorization) |
| `get_integration_nonce` | shipment_id: u64 | `u32` | See rustdoc (argument-based authorization) |
| `get_shipment_receiver` | shipment_id: u64 | `address` | See rustdoc (argument-based authorization) |
| `list_company_carriers` | company: address, candidates: Vec<address>, cursor: u32, page_size: u32 | `CarrierRelationshipPage` | See rustdoc (argument-based authorization) |
| `report_geofence_event` | carrier: address, shipment_id: u64, zone_type: GeofenceEvent, data_hash: BytesN<32> | `()` | Only registered carriers can report geofence events. |
| `reset_circuit_breaker` | admin: address | `()` | Only callable by the admin. |
| `set_shipment_metadata` | caller: address, shipment_id: u64, key: symbol, value: symbol | `()` | Only Company (sender) or Admin can set. |
| `verify_delivery_proof` | shipment_id: u64, proof_hash: BytesN<32> | `bool` | See rustdoc (argument-based authorization) |
| `check_deadline_warning` | shipment_id: u64, data_hash: BytesN<32> | `()` | See rustdoc (argument-based authorization) |
| `create_shipments_batch` | sender: address, shipments: Vec<ShipmentInput> | `Vec<u64>` | See rustdoc (argument-based authorization) |
| `get_non_terminal_count` | — | `u64` | See rustdoc (argument-based authorization) |
| `get_shipment_reference` | shipment_id: u64 | `string` | See rustdoc (argument-based authorization) |
| `get_ttl_health_summary` | — | `TtlHealthSummary` | See rustdoc (argument-based authorization) |
| `is_carrier_whitelisted` | company: address, carrier: address | `bool` | See rustdoc (argument-based authorization) |
| `add_shipment_dependency` | company: address, dependent_id: u64, prereq_id: u64 | `()` | See rustdoc (argument-based authorization) |
| `check_batch_consistency` | caller: address, ids: Vec<u64> | `Vec<ConsistencyViolation>` | See rustdoc (argument-based authorization) |
| `compute_idempotency_key` | shipment_id: u64, event_type: symbol, event_counter: u32 | `BytesN<32>` | See rustdoc (argument-based authorization) |
| `compute_proposal_digest` | proposal_id: u64, action: AdminAction | `()` | See rustdoc (argument-based authorization) |
| `get_platform_fee_config` | — | `{"option":{"value_type":{"udt":{"name":"FeeConfig"}}}}` | See rustdoc (argument-based authorization) |
| `get_shipment_created_at` | shipment_id: u64 | `u64` | See rustdoc (argument-based authorization) |
| `get_shipment_updated_at` | shipment_id: u64 | `u64` | See rustdoc (argument-based authorization) |
| `get_status_hash_history` | shipment_id: u64 | `Vec<StatusHashRecord>` | See rustdoc (argument-based authorization) |
| `record_milestones_batch` | carrier: address, shipment_id: u64, milestones: Vec<(symbol, BytesN<32>)> | `Vec<i128>` | See rustdoc (argument-based authorization) |
| `report_condition_breach` | carrier: address, shipment_id: u64, breach_type: BreachType, severity: Severity, data_hash: BytesN<32> | `()` | Only the assigned carrier can report a breach. |
| `add_carrier_to_whitelist` | company: address, carrier: address | `()` | Only the company can add carriers to their own whitelist. |
| `configure_settlement_nft` | admin: address, nft_contract: address, name: symbol, nft_symbol: symbol | `()` | Only the shipment admin may call this method. |
| `confirm_partial_delivery` | receiver: address, shipment_id: u64, confirmation_hash: BytesN<32>, release_percent: u32 | `()` | See rustdoc (argument-based authorization) |
| `get_escrow_freeze_reason` | shipment_id: u64 | `{"option":{"value_type":{"udt":{"name":"EscrowFreezeReason"}}}}` | See rustdoc (argument-based authorization) |
| `propose_action_with_salt` | proposer: address, action: AdminAction, salt: BytesN<32> | `u64` | See rustdoc (argument-based authorization) |
| `get_active_shipment_count` | company: address | `u32` | See rustdoc (argument-based authorization) |
| `get_creation_quota_status` | company: address | `(u32, u32)` | See rustdoc (argument-based authorization) |
| `release_milestone_payment` | caller: address, shipment_id: u64, milestone_name: symbol | `()` | Only Carrier or Admin can call this. |
| `get_circuit_breaker_config` | — | `CircuitBreakerConfig` | See rustdoc (argument-based authorization) |
| `get_circuit_breaker_status` | — | `(CircuitBreakerState, u32, u64)` | See rustdoc (argument-based authorization) |
| `get_dispute_evidence_count` | shipment_id: u64 | `u32` | See rustdoc (argument-based authorization) |
| `get_proposal_action_digest` | proposal_id: u64 | `ProposalActionDigest` | See rustdoc (argument-based authorization) |
| `is_company_carrier_allowed` | company: address, carrier: address | `bool` | See rustdoc (argument-based authorization) |
| `set_circuit_breaker_config` | admin: address, preset: CircuitBreakerPreset | `()` | See rustdoc (argument-based authorization) |
| `set_company_shipment_limit` | admin: address, company: address, limit: u32 | `()` | See rustdoc (argument-based authorization) |
| `get_expected_token_decimals` | — | `u32` | See rustdoc (argument-based authorization) |
| `get_effective_shipment_limit` | company: address | `u32` | See rustdoc (argument-based authorization) |
| `query_audit_history_by_actor` | actor: address | `Vec<AuditLogEntry>` | See rustdoc (argument-based authorization) |
| `remove_carrier_from_whitelist` | company: address, carrier: address | `()` | Only the company can remove carriers from their own whitelist. |
| `query_audit_history_for_target` | target: address | `Vec<AuditLogEntry>` | See rustdoc (argument-based authorization) |

### 1.1 `update_status` (v2.1, #1047)

Sourced from the real contract (`Navin-xmr/navin-contracts`, `contracts/shipment/src/lib.rs`), not inferred.

- `shipment_id` is a **`u64`** (decimal string in `UpdateStatusArgs`), unlike the legacy `Symbol` ids above.
- `new_status: ShipmentStatus` is a unit-variant `#[contracttype]` enum, encoded as ScVal `vec[Symbol(<Variant>)]`.
  Variants (declaration order, an ABI contract — renames/reorders are breaking):
  `Created, InTransit, AtCheckpoint, PartiallyDelivered, Delivered, Disputed, Cancelled, PartiallyRefunded`.
- `data_hash` is computed by the **backend** over the canonical status payload. The adapter encodes it as 32 raw bytes and
  never hashes, normalizes or alters it.
- Errors use the contract's real `NavinError` numbering (see §3.1), decoded per-function.

---

## 2. Events

### Soroban primitive and struct representation

| Primitive / struct  | JSON representation                  | Validation                                                                                   |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `u64`               | unsigned decimal string              | `0` through `18446744073709551615`, no leading zeroes                                        |
| `i128`              | signed decimal string                | `-170141183460469231731687303715884105728` through `170141183460469231731687303715884105727` |
| `Address`           | Stellar `G…` or `C…` strkey          | base-32 strkey shape, exactly 56 characters                                                  |
| `BytesN<32>`        | lowercase 64-character hex           | exactly 32 bytes                                                                             |
| `Symbol`            | ASCII string                         | 1–32 characters matching `[A-Za-z0-9_]`                                                      |
| `Vec<(Symbol,u32)>` | JSON array of `[symbol, u32]` tuples | each tuple has exactly two elements                                                          |
| `ShipmentStatus`    | PascalCase contract enum             | contract status variants                                                                     |
| `Role`              | uppercase string enum                | contract role constants                                                                      |
| `SettlementStatus`  | uppercase string enum                | contract settlement constants                                                                |

`i128` amounts are stored as integer stroops/base units with 7 decimal places of precision.
The JSON decimal string is the only accepted representation; JavaScript `number` values are
rejected to avoid precision loss. Convert human-readable units with exactly 7 decimal places
to/from stroops by shifting by `10^7`.

Every published event uses a single `Symbol` topic. Schema-aware events end with the tuple suffix `(schema_version: u32 = 2, event_counter: u32, idempotency_key: BytesN<32>)`; the `idempotency_key` is generated per (domain, event_counter, topic) and is the stable dedupe key persisted by the backend ledger (see `LedgerBlock.idempotencyKey`).

| Emitter | Topic | Data tuple fields |
| --- | --- | --- |
| `emit_whitelist_added` | `add_wl` | company.clone() carrier.clone() EVENT_SCHEMA_VERSION event_counter idempotency_key |
| `emit_whitelist_removed` | `rm_wl` | company.clone() carrier.clone() EVENT_SCHEMA_VERSION event_counter idempotency_key |
| `emit_multisig_initialized` | `ms_init` | admin_count threshold EVENT_SCHEMA_VERSION event_counter idempotency_key |
| `emit_proposal_approved` | `approve` | proposal_id approver.clone() approval_count EVENT_SCHEMA_VERSION event_counter idempotency_key |
| `emit_proposal_executed` | `executed` | proposal_id action.clone() EVENT_SCHEMA_VERSION event_counter idempotency_key |
| `emit_circuit_breaker_config_updated` | `config_updated` | Symbol::new(env, "circuit_breaker") failure_threshold recovery_timeout half_open_max_requests EVENT_SCHEMA_VERSION event_counter idempotency_key |
| `emit_shipment_created` | `shipment_created` | shipment_id ShipmentStatus::Created data_hash.clone() env.ledger().timestamp() actor.clone() |
| `emit_status_updated` | `status_updated` | shipment_id status.clone() data_hash.clone() env.ledger().timestamp() actor.clone() |
| `emit_milestone_recorded` | `milestone_recorded` | shipment_id ShipmentStatus::InTransit data_hash.clone() env.ledger().timestamp() reporter.clone() checkpoint.clone() |
| `emit_escrow_deposited` | `escrow_deposited` | shipment_id ShipmentStatus::Created data_hash env.ledger().timestamp() from.clone() amount |
| `emit_escrow_released` | `escrow_released` | shipment_id ShipmentStatus::Delivered data_hash env.ledger().timestamp() to.clone() amount |
| `emit_escrow_refunded` | `escrow_refunded` | shipment_id ShipmentStatus::Cancelled data_hash env.ledger().timestamp() to.clone() amount |
| `emit_milestone_payment_released` | `milestone_payment_released` | shipment_id ShipmentStatus::InTransit data_hash env.ledger().timestamp() to.clone() milestone.clone() amount |
| `emit_dispute_raised` | `dispute_raised` | (see rustdoc) |
| `emit_shipment_cancelled` | `shipment_cancelled` | shipment_id ShipmentStatus::Cancelled reason_hash.clone() env.ledger().timestamp() caller.clone() |
| `emit_contract_upgraded` | `contract_upgraded` | (see rustdoc) |
| `emit_migration_report` | `migration_reported` | report.current_version report.target_version report.affected_shipments |
| `emit_carrier_handoff` | `carrier_handoff` | shipment_id from_carrier.clone() to_carrier.clone() handoff_hash.clone() |
| `emit_condition_breach` | `condition_breach` | shipment_id carrier.clone() breach_type.clone() severity.clone() data_hash.clone() |
| `emit_admin_proposed` | `admin_proposed` | (see rustdoc) |
| `emit_admin_transferred` | `admin_transferred` | (see rustdoc) |
| `emit_shipment_expired` | `shipment_expired` | shipment_id ShipmentStatus::Cancelled data_hash env.ledger().timestamp() admin.clone() |
| `emit_delivery_success` | `delivery_success` | shipment_id ShipmentStatus::Delivered zero_hash delivery_time carrier.clone() |
| `emit_carrier_breach` | `carrier_breach` | carrier.clone() shipment_id breach_type.clone() severity.clone() |
| `emit_carrier_dispute_loss` | `carrier_dispute_loss` | (see rustdoc) |
| `emit_notification` | `notification` | recipient.clone() notification_type shipment_id data_hash.clone() |
| `emit_carrier_late_delivery` | `carrier_late_delivery` | (see rustdoc) |
| `emit_carrier_on_time_delivery` | `carrier_on_time_delivery` | (see rustdoc) |
| `emit_carrier_handoff_completed` | `carrier_handoff_completed` | (see rustdoc) |
| `emit_role_revoked` | `role_revoked` | (see rustdoc) |
| `emit_role_changed` | `role_changed` | action.clone() admin.clone() target.clone() role.clone() env.ledger().timestamp() |
| `emit_carrier_milestone_rate` | `carrier_milestone_rate` | carrier.clone() shipment_id milestones_hit total_milestones |
| `emit_force_cancelled` | `force_cancelled` | shipment_id ShipmentStatus::Cancelled reason_hash.clone() env.ledger().timestamp() admin.clone() escrow_refunded |
| `emit_force_released` | `force_released` | shipment_id ShipmentStatus::Delivered reason_hash.clone() env.ledger().timestamp() admin.clone() escrow_released |
| `emit_force_refunded` | `force_refunded` | shipment_id ShipmentStatus::Cancelled reason_hash.clone() env.ledger().timestamp() admin.clone() escrow_refunded |
| `emit_dispute_resolved` | `dispute_resolved` | shipment_id resolution.clone() reason_hash.clone() admin.clone() |
| `emit_contract_paused` | `contract_paused` | (see rustdoc) |
| `emit_contract_unpaused` | `contract_unpaused` | (see rustdoc) |
| `emit_escrow_frozen` | `escrow_frozen` | shipment_id reason caller.clone() env.ledger().timestamp() |
| `emit_platform_fee_collected` | `platform_fee_collected` | shipment_id ShipmentStatus::Created data_hash env.ledger().timestamp() treasury.clone() amount |
| `emit_fee_config_updated` | `fee_config_updated` | (see rustdoc) |
| `emit_contract_initialized` | `init` | (see rustdoc) |
| `emit_shipment_limit_updated` | `set_limit` | (see rustdoc) |
| `emit_company_limit_updated` | `set_cmp_limit` | (see rustdoc) |
| `emit_carrier_suspended` | `carrier_suspended` | (see rustdoc) |
| `emit_carrier_reactivated` | `carrier_reactivated` | (see rustdoc) |
| `emit_delivery_confirmed` | `delivery_confirmed` | shipment_id ShipmentStatus::Delivered data_hash.clone() env.ledger().timestamp() receiver.clone() |
| `emit_geofence_event` | `geofence_event` | shipment_id zone_type data_hash.clone() env.ledger().timestamp() actor.clone() |
| `emit_eta_updated` | `eta_updated` | shipment_id ShipmentStatus::InTransit data_hash.clone() env.ledger().timestamp() actor.clone() new_eta |
| `emit_proposal_digest` | `proposal_digest` | (see rustdoc) |
| `emit_config_updated` | `config_updated` | (see rustdoc) |
| `emit_quota_set` | `quota_set` | (see rustdoc) |
| `emit_evidence_added` | `evidence_added` | shipment_id submitted_by.clone() index evidence_hash.clone() |

| Name                 | Topic tuple                        | Data tuple                                                                                                            |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `anchor`             | `["anchor", shipment_id: Symbol]`  | `(data_hash: Bytes32Hex, ledger: u32)`                                                                                |
| `esc_init`           | `["esc_init", payment_id: Symbol]` | `(shipment_id: Symbol, payer: Address, payee: Address, token: C…, amount: i128-string)`                               |
| `esc_rel`            | `["esc_rel", payment_id: Symbol]`  | `(proof_hash: Bytes32Hex, payee: Address, amount: i128-string)`                                                       |
| `delivery_success`   | `["delivery_success"]`             | `(shipment_id: u64-string, status: "Delivered", data_hash: Bytes32Hex, delivery_time: u64-string, carrier: Address)`  |
| `delivery_confirmed` | `["delivery_confirmed"]`           | `(shipment_id: u64-string, status: "Delivered", data_hash: Bytes32Hex, delivery_time: u64-string, receiver: Address)` |
| `dispute_raised`     | `["dispute_raised"]`               | `(shipment_id: Symbol, raised_by: Address, reason_hash: Bytes32Hex)`                                                  |
| `escrow_frozen`      | `["escrow_frozen"]`                | `(shipment_id: Symbol, reason: EscrowFreezeReason, caller: Address, timestamp: u64-string)`                           |
| `dispute_resolved`   | `["dispute_resolved"]`             | `(shipment_id: Symbol, resolution: DisputeResolution, reason_hash: Bytes32Hex, admin: Address)`                       |

### 2.2 Delivery events and indexing (v2.2, #1043)

Layout taken from the contract's emitter code (`navin-contracts` `events.rs`; its own
`test_snapshot_delivery_success_payload_shape` pins the 5-field tuple). The contract's `docs/events.md`
still describes an older `(carrier, shipment_id, delivery_time)` layout — the code is authoritative.

- Both events are emitted in the **same transaction** (`confirm_delivery`), so they share `tx_hash`. The indexer therefore does
  **not** key them by transaction (as `LedgerBlock` is); it folds them into one `ShipmentDelivery` per on-chain shipment id.
- The trailing address is the **carrier** for `delivery_success` but the **receiver** for `delivery_confirmed`.
- `delivery_time` is the chain's ledger timestamp in unix **seconds**. It is the only time source: the server clock is never used.
- Idempotency identity is the RPC event `id`; replays and re-emissions are no-ops. `delivery_success` is authoritative for
  `deliveryTime`; `delivery_confirmed` supplies it only if it arrives first. Either arrival order is safe.
- Classification against `Shipment.expectedDelivery` (resolved via `Shipment.chainShipmentId`): **`ON_TIME` iff `delivery_time <= deadline`**
  (the boundary instant is on time; matches the contract's `now > deadline` ⇒ late). `LATE` otherwise. `UNKNOWN` when the shipment or
  deadline is not resolvable; it is recomputed only while `UNKNOWN`, and frozen once `ON_TIME`/`LATE`.
- Migration `20261122000000-shipment-delivery-indexes.js` adds the indexes. Nothing populates `Shipment.chainShipmentId` yet
  (shipment creation still anchors by ObjectId symbol), so until it is set deliveries are recorded as `UNKNOWN`.

## 3. Errors (`NavinError` discriminants, verbatim)

| Variant | `u32` |
| --- | --- |
| `AlreadyInitialized` | 1 |
| `NotInitialized` | 2 |
| `Unauthorized` | 3 |
| `ShipmentNotFound` | 4 |
| `InvalidStatus` | 5 |
| `InvalidHash` | 6 |
| `EscrowLocked` | 7 |
| `InsufficientFunds` | 8 |
| `ShipmentAlreadyCompleted` | 9 |
| `InvalidTimestamp` | 10 |
| `CounterOverflow` | 11 |
| `InvalidAmount` | 14 |
| `ReentrancyDetected` | 15 |
| `BatchTooLarge` | 16 |
| `InvalidShipmentInput` | 17 |
| `MilestoneSumInvalid` | 18 |
| `MilestoneAlreadyPaid` | 19 |
| `MetadataLimitExceeded` | 20 |
| `RateLimitExceeded` | 21 |
| `ProposalNotFound` | 22 |
| `ProposalAlreadyExecuted` | 23 |
| `ProposalExpired` | 24 |
| `AlreadyApproved` | 25 |
| `InsufficientApprovals` | 26 |
| `NotAnAdmin` | 27 |
| `InvalidMultiSigConfig` | 28 |
| `NotExpired` | 29 |
| `ShipmentLimitReached` | 30 |
| `InvalidConfig` | 31 |
| `CannotSelfRevoke` | 32 |
| `CarrierSuspended` | 33 |
| `ForceCancelReasonHashMissing` | 34 |
| `ArithmeticError` | 35 |
| `DisputeReasonHashMissing` | 36 |
| `CompanySuspended` | 37 |
| `ShipmentFinalized` | 38 |
| `TokenTransferFailed` | 39 |
| `TokenMintFailed` | 40 |
| `DuplicateAction` | 41 |
| `ShipmentUnavailable` | 42 |
| `ContractPaused` | 43 |
| `StatusHashNotFound` | 44 |
| `DataHashMismatch` | 45 |
| `CircuitBreakerOpen` | 46 |
| `InvalidMigrationEdge` | 47 |
| `MilestoneLimitExceeded` | 48 |
| `NoteLimitExceeded` | 49 |
| `EvidenceLimitExceeded` | 50 |
| `BreachLimitExceeded` | 51 |
| `InvalidTokenDecimals` | 52 |
| `CreationQuotaExceeded` | 53 |
| `DependenciesNotMet` | 54 |
| `CircularDependency` | 55 |
| `ProposalSaltReused` | 56 |
| `InvalidShipmentParticipants` | 57 |
| `InvalidShipmentDeadline` | 58 |
| `InvalidPaymentMilestones` | 59 |
| `DuplicatePaymentMilestone` | 60 |
| `InvalidTokenAddress` | 61 |
| `InvalidPaymentMilestoneName` | 62 |
| `MetadataSymbolCollision` | 63 |
| `ExternalIntegrationFailed` | 64 |
| `InvalidSymbol` | 65 |
| `NoteNotFound` | 66 |
| `EvidenceNotFound` | 67 |
| `RoleAlreadyAssigned` | 68 |
| `CarrierAlreadyWhitelisted` | 75 |
| `CarrierNotWhitelisted` | 69 |
| `InvalidAddress` | 70 |
| `RoleMismatch` | 72 |
| `InvalidSymbolEncoding` | 73 |
| `MultiSigProposalPending` | 74 |
| `AuditLogLimitExceeded` | 76 |
| `NftMintFailed` | 77 |
| `NftConfigurationFailed` | 78 |

Unknown discriminants map to `ERR_CHAIN_UNKNOWN` (HTTP 502) at the backend boundary.

### 2.1 Dispute lifecycle (#1053)

Sourced from the deployed contract (`raise_dispute` / `resolve_dispute` in
`Navin-xmr/navin-contracts`, `contracts/shipment/src/lib.rs`), not inferred.

1. `raise_dispute(caller, shipment_id, reason_hash)` sets the shipment to `Disputed`,
   records `EscrowFreezeReason::DisputeRaised`, then emits **`dispute_raised`** and
   **`escrow_frozen`** in the same transaction. Both events share one `tx_hash`; the
   indexer merges the freeze into the dispute's ledger row instead of replacing it.
2. `resolve_dispute(admin, shipment_id, resolution, reason_hash)` requires `Disputed`,
   settles escrow, clears the freeze, and emits **`dispute_resolved`** with the
   `DisputeResolution` variant it applied.

Projection rules:

| Chain event        | Ledger milestone | Projection metadata                                                                       |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `dispute_raised`   | `DISPUTED`       | `disputeState: 'OPEN'`, `reasonHash`, `raisedBy`                                          |
| `escrow_frozen`    | `ESCROW_FROZEN`* | `escrowFrozen: true`, `escrowFreezeReason`, `frozenBy`, `frozenAt`                        |
| `dispute_resolved` | `RESOLVED`       | `disputeState: 'CLOSED'`, `resolution`, `reasonHash`, `resolvedBy`, `escrowFrozen: false` |

\* merged into the existing `DISPUTED` row when emitted in the same transaction.

- **Reason hashes only.** The off-chain evidence (text, photos) is never on-chain;
  its SHA-256 digest is stored verbatim and never parsed as free text.
- **Resolution is reflected.** `resolution` is the contract's enum variant
  (`ReleaseToCarrier` | `RefundToCompany` | `PartialRefund`) — the projection never
  derives an outcome from the resulting shipment status.
- **Unfreeze is explicit.** There is no `escrow_unfrozen` event; the contract clears
  the freeze while resolving, so `dispute_resolved` carries `escrowFrozen: false`.
- `EscrowFreezeReason` variants: `DisputeRaised`, `CarrierSuspended`,
  `CompanySuspended`, `ContractPaused`, `CircuitBreakerOpen`.

> **Known gap:** the deployed contract types `shipment_id` as `u64`, while the backend
> carries its shipment ObjectId string as a Soroban `Symbol` (same legacy convention as
> `anchor`/`esc_*` above). That is what lets the indexer resolve `LedgerBlock.shipmentId`;
> reconciling numeric contract ids is the same follow-up tracked in §1.1.

---

## 3. Errors (`u32` → backend code)

| Contract error          | `u32` | Backend code                        | HTTP |
| ----------------------- | ----- | ----------------------------------- | ---- |
| `NotAuthorized`         | 1     | `ERR_CHAIN_UNAUTHORIZED`            | 403  |
| `InvalidHash`           | 2     | `ERR_CHAIN_INVALID_HASH`            | 422  |
| `AlreadyAnchored`       | 3     | `ERR_CHAIN_ALREADY_ANCHORED`        | 409  |
| `EscrowExists`          | 4     | `ERR_CHAIN_ESCROW_EXISTS`           | 409  |
| `EscrowNotFound`        | 5     | `ERR_CHAIN_ESCROW_NOT_FOUND`        | 404  |
| `EscrowAlreadyReleased` | 6     | `ERR_CHAIN_ESCROW_ALREADY_RELEASED` | 409  |
| `InvalidAmount`         | 7     | `ERR_CHAIN_INVALID_AMOUNT`          | 422  |
| `InvalidProof`          | 8     | `ERR_CHAIN_INVALID_PROOF`           | 422  |
| `InvalidStatus`         | 9     | `ERR_CHAIN_INVALID_STATUS`          | 409  |
| `MissingAuth`           | 10    | `ERR_CHAIN_MISSING_AUTH`            | 403  |
| `InsufficientBudget`    | 11    | `ERR_CHAIN_INSUFFICIENT_BUDGET`     | 402  |
| `MissingTrustline`      | 12    | `ERR_CHAIN_MISSING_TRUSTLINE`       | 422  |
| unknown                 | other | `ERR_CHAIN_UNKNOWN`                 | 502  |

Decoded via `chainErrorToAppError()`.

### Submission reliability (`SorobanAdapter`, #1078)

- **Retry:** a submission that is not confirmed within the polling window fails with `ERR_CHAIN_SUBMISSION_TIMEOUT` and is retried up to `CHAIN_SUBMIT_MAX_ATTEMPTS` times (default 3) with exponential backoff from `CHAIN_SUBMIT_BACKOFF_MS` (default 500 ms), capped at `CHAIN_SUBMIT_BACKOFF_MAX_MS`, with jitter. Contract rejections and validation errors are never retried.
- **Duplicate detection:** before every retry the adapter asks the chain whether any earlier attempt's transaction confirmed (`getTransactionLedger`). If one did, its receipt is returned and nothing is sent again. A contract rejection of `AlreadyAnchored` / `EscrowAlreadyReleased` after a timeout gets the same check. If the earlier attempt cannot be verified, the call fails rather than risk a duplicate.
- **Idempotency key:** pass `ChainSubmitOptions { eventType, eventCounter, shipmentId? }` as the second argument of `anchorEvent` / `releaseEscrow`. The key is `sha256(JSON([shipment_id, event_type, event_counter]))` (`buildIdempotencyKey`). A repeat of a completed event returns the original receipt without touching the chain, and a concurrent repeat joins the in-flight call. The record is in memory and per process (bounded to 1000 entries), so after a restart the on-chain duplicate check is what protects you. `releaseEscrow` takes `shipmentId` in the options because its input carries a payment id only. Callers that pass no options get retry but no key-based deduplication.

### Preflight checks (`SorobanAdapter`, #1081)

Off by default. With `CHAIN_PREFLIGHT_ENABLED=true`, read-only checks run before a transaction is signed, in this order, each selectable through `CHAIN_PREFLIGHT_CHECKS` (comma list):

| Check            | Passes when                                                     | Error                               |
| ---------------- | --------------------------------------------------------------- | ----------------------------------- |
| `initialized`    | the contract is initialized                                     | `ERR_CHAIN_NOT_INITIALIZED`         |
| `roles`          | the actor holds the Company or Carrier role                     | `ERR_CHAIN_ROLE_REQUIRED`           |
| `whitelist`      | a Carrier-only actor is whitelisted (Company actors are exempt) | `ERR_CHAIN_CARRIER_NOT_WHITELISTED` |
| `suspension`     | the actor is not suspended                                      | `ERR_CHAIN_ACTOR_SUSPENDED`         |
| `token_decimals` | the escrow token reports 7 decimals                             | `ERR_CHAIN_INVALID_TOKEN_DECIMALS`  |

`anchorEvent` checks the `actor`; `releaseEscrow` checks initialization only. `token_decimals` runs when a token is supplied to `runChainPreflight` (escrow initialization); no current port method carries one. The checks read state through `SorobanStateReader`, which calls these **assumed** contract view functions: `is_initialized()`, `has_role(address, role)`, `is_carrier_whitelisted(address)`, `is_suspended(address)`, plus the token's SEP-41 `decimals()`. This spec does not define the first four yet, so confirm or rename them in `CONTRACT_VIEW_FUNCTIONS` before enabling preflight against a deployed contract.

### 3.1 `update_status` errors (real `NavinError` numbering)

The table above predates the deployed contract and numbers errors differently (its `InvalidStatus` is `9`; the contract's is `5`).
`update_status` therefore decodes with its own function-scoped table via `updateStatusErrorToAppError()`:

| Contract error      | `u32` | Backend code                                 | HTTP |
| ------------------- | ----- | -------------------------------------------- | ---- |
| `Unauthorized`      | 3     | `ERR_CHAIN_UNAUTHORIZED`                     | 403  |
| `ShipmentNotFound`  | 4     | `ERR_CHAIN_SHIPMENT_NOT_FOUND`               | 404  |
| `InvalidStatus`     | 5     | `ERR_CHAIN_INVALID_STATUS`                   | 409  |
| `InvalidHash`       | 6     | `ERR_CHAIN_INVALID_HASH`                     | 422  |
| `ShipmentFinalized` | 38    | `ERR_CHAIN_INVALID_STATUS`                   | 409  |
| `DuplicateAction`   | 41    | `ERR_CHAIN_DUPLICATE_ACTION`                 | 409  |
| other               | —     | `ERR_CHAIN_UNKNOWN` (code kept in `details`) | 502  |

> **Follow-up:** reconcile the legacy anchor/escrow error table and `Symbol` shipment ids with the deployed contract ABI.

---

## 4. Version policy

- `CHAIN_SPEC_VERSION` bumps on any function/event/error shape change.
- Doc, `chain.ts`, and fixtures land in the same PR; `tests/chain.types.test.ts` enforces the triple.
- Field names stay `snake_case` to mirror the Soroban ABI; object key order is significant.

---

## 5. Confirmation depth (#1058)

Every anchored event class — shipment anchors, status updates, milestones and escrow — exposes
the same verification pair:

| Field           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `confirmations` | Ledgers closed strictly after the event's ledger (`0` at the head). |
| `verified`      | `true` once `confirmations >= threshold`.                           |

The threshold is configured per network: `CHAIN_CONFIRMATIONS_TESTNET` / `CHAIN_CONFIRMATIONS_PUBLIC`
(default `3` each), exposed as `config.chainConfirmations`. `ChainAdapter.getConfirmationCount(ledger)`
is the single depth source; the indexer stores both fields on every `LedgerBlock` and its
reconciliation pass moves rows forward idempotently (a confirmed row is never downgraded).
Fixture tests exercise depths `0, 2, 3, 10`.

---

## 6. Adapter strategy

`ChainAdapter` port (`src/services/chain/types.ts`): `anchorEvent`, `releaseEscrow`, `updateStatus`, `streamEvents`
plus `getConfirmationCount` (and optional ledger query helpers). `SimulatedAdapter` for local
dev/tests; `SorobanAdapter` for deployed WASM escrow. The legacy `stellar.service.ts` was removed in #1082;
its manage-data logic lives only inside `SimulatedAdapter`.

## 7. Frontend verification v2

The backend adapter schemas above remain v2.1. The contracts v2 frontend flow verifies the contract's `shipment_created`, `status_updated`, and `milestone_recorded` events directly; it does **not** look for the legacy `anchor` event or a `dataHash` bundle. See the [frontend verification guide](./frontend-chain-verification.md) for a runnable example and fixture.

For each action, fetch the canonical payload and expected hash from the verification API, then query the selected network's Soroban RPC for the transaction and event. Accept only a successful transaction and an event from the configured contract, on the configured network, with the expected event name and transaction hash. Decode the event's `data_hash`, schema version (`version` in the v2 event data), counter, and `idempotency_key` using the contract ABI.

The payload is recursively key-sorted and compact-JSON serialized before SHA-256. The payload's `schema_version` and `idempotency_key` are included in those bytes, so neither may be dropped, defaulted, or substituted during canonicalization. Independently recompute the idempotency key as SHA-256 of `shipment_id` encoded as u64 big-endian, the event type encoded as a Soroban Symbol XDR value, and `event_counter` encoded as u32 big-endian. Require the decoded version and recomputed key to match the canonical payload before comparing its digest with the event's `data_hash`.

The canonical tuple ordering and event-specific ABI are owned by [navin-contracts `FRONTEND_VERIFICATION.md`](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/FRONTEND_VERIFICATION.md). Treat an unknown version, network/contract mismatch, missing event, or any mismatch as **unverified**; do not fall back to backend-provided status.

## 8. Local quickstart integration

Run the Soroban quickstart harness with a navin-contracts WASM artifact:

```bash
NAVIN_CONTRACTS_WASM=/path/to/navin_escrow.wasm npm run quickstart:chain
```

The command starts `docker-compose.quickstart.yml`, waits for the local RPC, deploys the
WASM, and tears down the isolated Compose project. It is intentionally outside required PR
CI and runs in `.github/workflows/tests-nightly.yml` nightly.
