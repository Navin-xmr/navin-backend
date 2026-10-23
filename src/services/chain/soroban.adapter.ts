import {
  rpc,
  Contract,
  Address,
  nativeToScVal,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { config } from '../../config/index.js';
import { stellarNetworkPassphrase } from '../../config/stellarNetwork.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import {
  Bytes32HexSchema,
  parseChainEvent,
  chainErrorToAppError,
} from '../../shared/types/chain.js';
import type { ChainEvent } from '../../shared/types/chain.js';
import type {
  AnchorEventInput,
  AnchorResult,
  ChainAdapter,
  ChainEventCursor,
  EscrowResult,
  ReleaseEscrowInput,
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
    if (!Bytes32HexSchema.safeParse(input.proof_hash).success) {
      throw new AppError(
        422,
        'proof_hash must be 32 bytes of lowercase hex',
        ErrorCodes.CHAIN_INVALID_PROOF
      );
    }

    const contract = this.getContract();
    const op = contract.call(
      'release_escrow',
      nativeToScVal(input.payment_id, { type: 'symbol' }),
      nativeToScVal(Buffer.from(input.proof_hash, 'hex'), { type: 'bytes' })
    );

    const { txHash, ledger } = await this.invokePipeline(op);
    return { txHash, ledger, simulated: false, paymentId: input.payment_id };
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
  ): Promise<{ txHash: string; ledger: number }> {
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
      throw new AppError(
        400,
        `Soroban simulation failed: ${simRes.error}`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }

    // 2. Assemble
    const assembled = rpc.assembleTransaction(tx, simRes).build();

    // 3. Sign
    assembled.sign(keypair);

    // 4. Send
    const sendRes = await this.server.sendTransaction(assembled);
    if (sendRes.status === 'ERROR') {
      throw new AppError(400, `Soroban sendTransaction failed`, ErrorCodes.CHAIN_UNKNOWN, sendRes);
    }

    // 5. Poll
    const txHash = sendRes.hash;
    let statusRes: rpc.Api.GetTransactionResponse;
    const startTime = Date.now();
    const timeoutMs = 30000;

    for (;;) {
      statusRes = await this.server.getTransaction(txHash);
      if (statusRes.status === 'SUCCESS') {
        return { txHash, ledger: statusRes.ledger };
      }
      if (statusRes.status === 'FAILED') {
        throw new AppError(
          400,
          'Soroban transaction execution failed on-chain',
          ErrorCodes.CHAIN_UNKNOWN,
          statusRes
        );
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new AppError(504, 'Soroban transaction polling timed out', ErrorCodes.CHAIN_UNKNOWN);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
