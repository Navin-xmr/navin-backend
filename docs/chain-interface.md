# Chain Adapter Interface Specification (shipment contract)

**Status:** v2 (`CHAIN_SPEC_VERSION = 2.0.0`) — ABI-verified; contracts-maintainer sign-off pending

This is the normative v2 surface of the deployed **Navin Shipment** Soroban contract.
It replaces the DRAFT v0 document (which described `initialize` / `confirm_milestone` /
`release` as a single escrow-only API). Authoritative upstream sources:

- Function/argument/return table: [contract-schema.shipment.json](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/contract-schema.shipment.json) (vendored at `contracts/abi/contract-schema.shipment.json`)
- Event topics: `contracts/shipment/src/event_topics.rs`; payloads: `contracts/shipment/src/events.rs` and `docs/events.md`
- Errors: `contracts/shipment/src/errors.rs` (discriminants verbatim below)

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

## 2. Events

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
