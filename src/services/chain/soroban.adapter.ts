import {
  rpc,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { config } from '../../config/index.js';
import { stellarNetworkPassphrase } from '../../config/stellarNetwork.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import {
  AddCarrierArgsSchema,
  AddCarrierToWhitelistArgsSchema,
  AddCompanyArgsSchema,
  AddressSchema,
  Bytes32HexSchema,
  CreateShipmentArgsSchema,
  RaiseDisputeArgsSchema,
  ResolveDisputeArgsSchema,
  SymbolSchema,
  parseChainEvent,
  chainErrorToAppError,
} from '../../shared/types/chain.js';
import type { ChainEvent } from '../../shared/types/chain.js';
import type {
  AddCarrierInput,
  AddCarrierToWhitelistInput,
  AddCompanyInput,
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainEventCursor,
  ChainTxReceipt,
  CreateShipmentInput,
  CreateShipmentResult,
  EscrowResult,
  RaiseDisputeInput,
  ReleaseEscrowInput,
  ResolveDisputeInput,
  RoleProvisionAction,
  RolePreflightResult,
  RoleProvisionResult,
} from './types.js';

export interface SorobanAdapterOptions {
  sorobanRpcUrl?: string;
  contractId?: string;
  secretKey?: string;
  networkPassphrase?: string;
  rpcServer?: rpc.Server;
}

export class SorobanAdapter implements ChainAdapter {
  private readonly server: rpc.Server;
  private readonly contractId: string;
  private readonly secretKey: string | undefined;
  private readonly networkPassphrase: string;

  constructor(options: SorobanAdapterOptions = {}) {
    const rpcUrl = options.sorobanRpcUrl ?? config.sorobanRpcUrl;
    this.server = options.rpcServer ?? new rpc.Server(rpcUrl);
    this.contractId = options.contractId ?? config.escrowContractId ?? '';
    this.secretKey = options.secretKey ?? config.stellarSecretKey;
    this.networkPassphrase =
      options.networkPassphrase ?? stellarNetworkPassphrase(config.stellarNetwork);
  }

  private signer(): Keypair {
    if (!this.secretKey) {
      throw new AppError(500, 'STELLAR_SECRET_KEY is not configured', ErrorCodes.CHAIN_UNKNOWN);
    }
    return Keypair.fromSecret(this.secretKey);
  }

  private getContract(): Contract {
    if (!this.contractId) {
      throw new AppError(500, 'ESCROW_CONTRACT_ID is not configured', ErrorCodes.CHAIN_UNKNOWN);
    }
    return new Contract(this.contractId);
  }

  async anchorEvent(input: AnchorEventInput): Promise<AnchorResult> {
    if (!Bytes32HexSchema.safeParse(input.data_hash).success) {
      throw new AppError(
        422,
        'data_hash must be 32 bytes of lowercase hex',
        ErrorCodes.CHAIN_INVALID_HASH
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'anchor',
      nativeToScVal(input.shipment_id, { type: 'symbol' }),
      nativeToScVal(Buffer.from(input.data_hash, 'hex'), { type: 'bytes' }),
      new Address(input.actor).toScVal()
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false };
  }

  async releaseEscrow(input: ReleaseEscrowInput): Promise<EscrowResult> {
    // v2 (#1056): real contract signature is (caller, shipment_id). Escrow is
    // per-shipment, so no payment_id/proof_hash are invented here.
    if (!AddressSchema.safeParse(input.caller).success) {
      throw new AppError(
        422,
        'caller must be a valid Stellar address',
        ErrorCodes.CHAIN_UNAUTHORIZED
      );
    }
    if (!SymbolSchema.safeParse(input.shipment_id).success) {
      throw new AppError(
        422,
        'shipment_id must be a valid Soroban Symbol',
        ErrorCodes.CHAIN_UNKNOWN
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'release_escrow',
      new Address(input.caller).toScVal(),
      nativeToScVal(input.shipment_id, { type: 'symbol' })
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false, shipmentId: input.shipment_id };
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const parsed = CreateShipmentArgsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        `Invalid create_shipment arguments: ${parsed.error.message}`,
        ErrorCodes.CHAIN_INVALID_AMOUNT
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'create_shipment',
      new Address(input.sender).toScVal(),
      new Address(input.receiver).toScVal(),
      new Address(input.carrier).toScVal(),
      nativeToScVal(Buffer.from(input.data_hash, 'hex'), { type: 'bytes' }),
      nativeToScVal(
        input.payment_milestones.map(m => BigInt(m)),
        { type: 'i128' }
      ),
      nativeToScVal(input.deadline, { type: 'u64' })
    );

    const { txHash, ledger, returnValue } = await this.invokePipeline(op);
    const shipmentId = typeof returnValue === 'bigint' ? Number(returnValue) : returnValue;
    if (typeof shipmentId !== 'number' || !Number.isFinite(shipmentId)) {
      throw new AppError(
        502,
        'create_shipment did not return a numeric shipment id',
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
    return { txHash, ledger, simulated: false, shipmentId };
  }

  async raiseDispute(input: RaiseDisputeInput): Promise<ChainTxReceipt> {
    const parsed = RaiseDisputeArgsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        `Invalid raise_dispute arguments: ${parsed.error.message}`,
        ErrorCodes.CHAIN_INVALID_HASH
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'raise_dispute',
      new Address(input.caller).toScVal(),
      nativeToScVal(input.shipment_id, { type: 'symbol' }),
      nativeToScVal(Buffer.from(input.reason_hash, 'hex'), { type: 'bytes' })
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false };
  }

  async resolveDispute(input: ResolveDisputeInput): Promise<ChainTxReceipt> {
    const parsed = ResolveDisputeArgsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        `Invalid resolve_dispute arguments: ${parsed.error.message}`,
        ErrorCodes.CHAIN_INVALID_TRANSITION
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'resolve_dispute',
      new Address(input.admin).toScVal(),
      nativeToScVal(input.shipment_id, { type: 'symbol' }),
      nativeToScVal(input.outcome, { type: 'symbol' })
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false };
  }

  async addCompany(input: AddCompanyInput): Promise<RoleProvisionResult> {
    const parsed = AddCompanyArgsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        `Invalid add_company arguments: ${parsed.error.message}`,
        ErrorCodes.CHAIN_ROLE_DENIED
      );
    }
    const { txHash, ledger } = await this.invokePipeline(this.roleOp('add_company', input));
    return { txHash, ledger, simulated: false };
  }

  async addCarrier(input: AddCarrierInput): Promise<RoleProvisionResult> {
    const parsed = AddCarrierArgsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        `Invalid add_carrier arguments: ${parsed.error.message}`,
        ErrorCodes.CHAIN_ROLE_DENIED
      );
    }
    const { txHash, ledger } = await this.invokePipeline(this.roleOp('add_carrier', input));
    return { txHash, ledger, simulated: false };
  }

  async addCarrierToWhitelist(input: AddCarrierToWhitelistInput): Promise<RoleProvisionResult> {
    const parsed = AddCarrierToWhitelistArgsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        `Invalid add_carrier_to_whitelist arguments: ${parsed.error.message}`,
        ErrorCodes.CHAIN_ROLE_DENIED
      );
    }
    const { txHash, ledger } = await this.invokePipeline(
      this.roleOp('add_carrier_to_whitelist', input)
    );
    return { txHash, ledger, simulated: false };
  }

  /**
   * Dry-run an RBAC action through simulation only — never assembled, signed or
   * sent. Reports the exact `ERR_CHAIN_*` the real submission would reject with,
   * so callers can surface an actionable error before spending a transaction.
   */
  async preflightRole(
    action: RoleProvisionAction,
    input: AddCompanyInput | AddCarrierInput | AddCarrierToWhitelistInput
  ): Promise<RolePreflightResult> {
    const keypair = this.signer();
    const sourceAccount = await this.server.getAccount(keypair.publicKey()).catch(() => {
      throw new AppError(502, 'Failed to load account from Soroban RPC', ErrorCodes.CHAIN_UNKNOWN);
    });
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.roleOp(action, input))
      .setTimeout(30)
      .build();

    const simRes = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationError(simRes)) {
      return { allowed: true };
    }
    const contractErrorMatch = String(simRes.error).match(/Error\(Contract, #(\d+)\)/);
    if (!contractErrorMatch?.[1]) {
      throw new AppError(400, 'Soroban simulation failed', ErrorCodes.CHAIN_UNKNOWN);
    }
    const err = chainErrorToAppError(parseInt(contractErrorMatch[1], 10));
    return { allowed: false, reason: err.code as RolePreflightResult['reason'] };
  }

  private roleOp(
    action: RoleProvisionAction,
    input: AddCompanyInput | AddCarrierInput | AddCarrierToWhitelistInput
  ): ReturnType<Contract['call']> {
    const contract = this.getContract();
    if (action === 'add_company') {
      const args = input as AddCompanyInput;
      return contract.call(
        action,
        new Address(args.admin).toScVal(),
        new Address(args.company).toScVal()
      );
    }
    const args = input as AddCarrierInput | AddCarrierToWhitelistInput;
    return contract.call(
      action,
      new Address(args.admin).toScVal(),
      new Address(args.company).toScVal(),
      new Address(args.carrier).toScVal()
    );
  }

  async *streamEvents(cursor?: ChainEventCursor): AsyncIterable<ChainEvent> {
    if (!this.contractId) return;

    let startLedger: number | undefined;
    if (cursor && /^\d+$/.test(cursor)) {
      startLedger = parseInt(cursor, 10);
    }

    try {
      const filters: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [this.contractId] }];
      const request: rpc.Api.GetEventsRequest = cursor
        ? { cursor, filters }
        : { startLedger: startLedger ?? 0, filters };

      const response = await this.server.getEvents(request);

      for (const rawEvent of response.events ?? []) {
        try {
          const parsed = parseChainEvent({
            id: rawEvent.id,
            contract_id: rawEvent.contractId,
            tx_hash: rawEvent.txHash,
            ledger: rawEvent.ledger,
            ledger_closed_at: rawEvent.ledgerClosedAt,
            name: rawEvent.topic?.[0],
            topic: rawEvent.topic,
            data: rawEvent.value,
          });
          yield parsed;
        } catch {
          // Skip unparseable / off-spec events
          continue;
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'Failed to fetch Soroban events', ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getConfirmationCount(ledger: number): Promise<number> {
    try {
      const latest = await this.server.getLatestLedger();
      return Math.max(0, latest.sequence - ledger);
    } catch (err) {
      throw new AppError(502, 'Failed to fetch latest Soroban ledger', ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Invocation pipeline: simulate -> assemble -> sign -> send -> poll
   */
  private async invokePipeline(
    op: ReturnType<Contract['call']>
  ): Promise<{ txHash: string; ledger: number; returnValue?: unknown }> {
    const keypair = this.signer();
    const sourceAccount = await this.server.getAccount(keypair.publicKey()).catch(() => {
      throw new AppError(502, 'Failed to load account from Soroban RPC', ErrorCodes.CHAIN_UNKNOWN);
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    // 1. Simulate
    const simRes = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simRes)) {
      const contractErrorMatch = String(simRes.error).match(/Error\(Contract, #(\d+)\)/);
      if (contractErrorMatch?.[1]) {
        throw chainErrorToAppError(parseInt(contractErrorMatch[1], 10));
      }
      throw new AppError(400, 'Soroban simulation failed', ErrorCodes.CHAIN_UNKNOWN);
    }

    // 2. Assemble
    const assembled = rpc.assembleTransaction(tx, simRes).build();

    // 3. Sign
    assembled.sign(keypair);

    // 4. Send
    const sendRes = await this.server.sendTransaction(assembled);
    if (sendRes.status === 'ERROR') {
      throw new AppError(400, 'Soroban sendTransaction failed', ErrorCodes.CHAIN_UNKNOWN);
    }

    // 5. Poll
    const txHash = sendRes.hash;
    let statusRes: rpc.Api.GetTransactionResponse;
    const startTime = Date.now();
    const timeoutMs = 30000;

    for (;;) {
      statusRes = await this.server.getTransaction(txHash);
      if (statusRes.status === 'SUCCESS') {
        const returnValue = statusRes.returnValue
          ? scValToNative(statusRes.returnValue)
          : undefined;
        return { txHash, ledger: statusRes.ledger, returnValue };
      }
      if (statusRes.status === 'FAILED') {
        throw new AppError(
          400,
          'Soroban transaction execution failed on-chain',
          ErrorCodes.CHAIN_UNKNOWN
        );
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new AppError(504, 'Soroban transaction polling timed out', ErrorCodes.CHAIN_UNKNOWN);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /** Latest ledger sequence reported by the RPC node (#818). */
  async getLatestLedger(): Promise<number> {
    const latest = await this.server.getLatestLedger();
    return latest.sequence;
  }

  /** Ledger containing a successful transaction; null if not found or not successful (#818). */
  async getTransactionLedger(txHash: string): Promise<number | null> {
    const res = await this.server.getTransaction(txHash);
    if (res.status === 'SUCCESS') {
      return (res as { ledger: number }).ledger;
    }
    return null;
  }
}
