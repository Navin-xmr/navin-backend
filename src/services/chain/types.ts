/**
 * ChainAdapter port (TODO J1 · P6-03).
 *
 * The only chain surface domain modules may depend on. Implementations
 * (SimulatedAdapter, SorobanAdapter) live beside this file and are selected by
 * config; `telemetry`/`payments`/`shipments`/`webhooks` import from HERE only —
 * never an implementation, never `stellar.service.ts` (AGENTS.md §7).
 *
 * Chain wire shapes (args, events) come from src/shared/types/chain.ts and are
 * not redefined here.
 *
 * Error contract: every method rejects with `AppError` carrying a
 * `ChainErrorCode` (`ERR_CHAIN_*`). Methods never resolve with a failure flag —
 * this replaces the silent `{ success: false }` of stellar.service.ts
 * `releaseEscrow()`. A resolved promise means the transaction is confirmed.
 */
import type { ErrorCode } from '../../shared/http/errors.js';
import type {
  AddCarrierArgs,
  AddCarrierToWhitelistArgs,
  AddCompanyArgs,
  AnchorArgs,
  ChainEvent,
  ChainFunctionName,
  CreateShipmentArgs,
  RaiseDisputeArgs,
  ReleaseEscrowArgs,
  ResolveDisputeArgs,
} from '../../shared/types/chain.js';

/** Backend error codes an adapter may reject with (via `AppError.code`). */
export type ChainErrorCode = Extract<ErrorCode, `ERR_CHAIN_${string}`>;

/** Input for `anchor(shipment_id, data_hash, actor)` — spec-validated shape. */
export type AnchorEventInput = AnchorArgs;

/** Input for `release_escrow(caller, shipment_id)` — spec-validated shape (v2). */
export type ReleaseEscrowInput = ReleaseEscrowArgs;

/** Input for `create_shipment(sender, receiver, carrier, data_hash, payment_milestones, deadline)` (#1037). */
export type CreateShipmentInput = CreateShipmentArgs;

/** Input for `raise_dispute(caller, shipment_id, reason_hash)` (#1036). */
export type RaiseDisputeInput = RaiseDisputeArgs;

/** Input for `resolve_dispute(admin, shipment_id, outcome)` (#1036). */
export type ResolveDisputeInput = ResolveDisputeArgs;

/** Input for `add_company(admin, company)` (#1042). */
export type AddCompanyInput = AddCompanyArgs;

/** Input for `add_carrier(admin, company, carrier)` (#1042). */
export type AddCarrierInput = AddCarrierArgs;

/** Input for `add_carrier_to_whitelist(admin, company, carrier)` (#1042). */
export type AddCarrierToWhitelistInput = AddCarrierToWhitelistArgs;

/** Confirmed on-chain transaction. */
export interface ChainTxReceipt {
  /** 64-char lowercase hex transaction hash. */
  txHash: string;
  /** Ledger sequence the transaction was confirmed in. */
  ledger: number;
  /** `true` when produced by the simulated adapter — no real contract call or funds moved. */
  simulated: boolean;
}

export type AnchorResult = ChainTxReceipt;

export interface EscrowResult extends ChainTxReceipt {
  /** Escrow is per-shipment (#1056) — this is the released shipment, not a payment id. */
  shipmentId: ReleaseEscrowInput['shipment_id'];
}

/** Result of `create_shipment` — receipt plus the contract-assigned `u64` id (#1037). */
export interface CreateShipmentResult extends ChainTxReceipt {
  shipmentId: number;
}

/** Result of a role-provisioning call (`add_company`/`add_carrier`/`add_carrier_to_whitelist`). */
export type RoleProvisionResult = ChainTxReceipt;

/** Outcome of a preflight role/whitelist check — no transaction is submitted (#1042). */
export interface RolePreflightResult {
  allowed: boolean;
  /** Set when `allowed` is false — the specific port error the submission would reject with. */
  reason?: ChainErrorCode;
}

/** RBAC actions `preflightRole` can check ahead of submission (#1042). */
export type RoleProvisionAction = Extract<
  ChainFunctionName,
  'add_company' | 'add_carrier' | 'add_carrier_to_whitelist'
>;

/** Opaque resume position: the `id` of the last event processed. */
export type ChainEventCursor = ChainEvent['id'];

export interface ChainAdapter {
  /**
   * Anchor a payload hash for a shipment.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ALREADY_ANCHORED).
   */
  anchorEvent(input: AnchorEventInput): Promise<AnchorResult>;

  /**
   * Release escrowed funds for a shipment, authorized by `caller`.
   * Escrow is per-shipment (#1056); there is no payment id or proof hash here.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_ESCROW_NOT_FOUND,
   * ERR_CHAIN_INVALID_STATUS, ERR_CHAIN_UNAUTHORIZED). Never resolves with a
   * `{ success: false }` failure flag.
   */
  releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult>;

  /**
   * Create a shipment on-chain (#1037). Participant distinctness and milestone
   * sums are validated locally for fast failure; the contract remains
   * authoritative — contract-side rejections surface unmapped via
   * `chainErrorToAppError`.
   * @returns The confirmed receipt plus the contract-assigned `u64` shipment id.
   * @throws {AppError} `ChainErrorCode` on rejection (e.g. ERR_CHAIN_INSUFFICIENT_FUNDS).
   */
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;

  /**
   * Raise a dispute for a shipment with a required reason hash (#1036).
   * The DB projection mirrors the outcome from the resulting `dispute_raised`
   * event rather than deciding locally.
   * @throws {AppError} `ChainErrorCode` (e.g. ERR_CHAIN_SHIPMENT_NOT_FOUND).
   */
  raiseDispute(input: RaiseDisputeInput): Promise<ChainTxReceipt>;

  /**
   * Resolve a previously raised dispute (#1036). The resolution outcome is
   * taken from the resulting `dispute_resolved` event, never decided locally.
   * @throws {AppError} `ChainErrorCode` (e.g. ERR_CHAIN_INVALID_TRANSITION).
   */
  resolveDispute(input: ResolveDisputeInput): Promise<ChainTxReceipt>;

  /** Provision a company role on-chain (#1042). */
  addCompany(input: AddCompanyInput): Promise<RoleProvisionResult>;

  /** Provision a carrier role on-chain, scoped to a company (#1042). */
  addCarrier(input: AddCarrierInput): Promise<RoleProvisionResult>;

  /** Add a carrier to a company's on-chain whitelist (#1042). */
  addCarrierToWhitelist(input: AddCarrierToWhitelistInput): Promise<RoleProvisionResult>;

  /**
   * Report whether an RBAC action would be rejected for missing role/whitelist
   * state *before* submitting it (#1042) — no transaction is sent. Backed by
   * read-only simulation where the adapter supports it.
   */
  preflightRole(
    action: RoleProvisionAction,
    input: AddCompanyInput | AddCarrierInput | AddCarrierToWhitelistInput
  ): Promise<RolePreflightResult>;

  /**
   * Spec-validated contract events in ledger order, resuming strictly after
   * `cursor` (from the beginning when omitted). Consumers stop with `break`;
   * implementations must release resources in the iterator's `return()`.
   * @throws {AppError} ERR_CHAIN_INVALID_EVENT when an emitted event violates the spec.
   */
  streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent>;

  /**
   * Optional read-only ledger queries used by confirmation tracking (#818).
   * `getLatestLedger` returns the current ledger sequence. `getTransactionLedger`
   * returns the ledger containing a successful transaction, or null when the
   * transaction is not found or did not succeed.
   */
  getLatestLedger?(): Promise<number>;
  getTransactionLedger?(txHash: string): Promise<number | null>;
  /**
   * Confirmation count for a transaction at `ledger`.
   * Implementations return at least three immediately for simulated chains.
   */
  getConfirmationCount(ledger: number): Promise<number>;
}
