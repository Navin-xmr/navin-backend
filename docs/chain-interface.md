# Chain Adapter Interface Specification

**Status:** DRAFT v0

This document defines the formal `ChainAdapter` port interface and target contract method contracts for Navin Backend's Stellar / Soroban integration (issue [#360](https://github.com/Navin-xmr/navin-backend/issues/360)).

---

## Target Contract Methods

The Soroban escrow contract exposes the following core lifecycle operations:

| Method | Purpose |
|--------|---------|
| `initialize` | Create escrow for a shipment (parties, amount, token, milestone schedule) |
| `confirm_milestone` | Record that a lifecycle milestone was confirmed (carrier / oracle / backend) |
| `release` | Release escrowed value to the payee when delivery conditions are met |
| `get_state` | Return current escrow status, confirmed milestones, and balances for UI |

---

## ChainAdapter Service Contract

Below is the target TypeScript service surface for the blockchain adapter layer:

```ts
export interface EscrowContractClient {
  /**
   * Initialize a new escrow contract on-chain for a shipment.
   */
  initialize(params: {
    shipmentId: string;
    payer: string;
    payee: string;
    amount: string;
    asset: string;
  }): Promise<{ txHash: string; escrowId: string }>;

  /**
   * Record confirmation for a shipment milestone event.
   */
  confirmMilestone(params: {
    escrowId: string;
    milestone: string;
    actor: string;
  }): Promise<{ txHash: string }>;

  /**
   * Release escrowed funds upon verified delivery.
   */
  release(params: {
    escrowId: string;
    shipmentId: string;
  }): Promise<{ txHash: string }>;

  /**
   * Read the current on-chain state of an escrow contract.
   */
  getState(escrowId: string): Promise<{
    status: 'INITIALIZED' | 'IN_PROGRESS' | 'RELEASED' | 'DISPUTED';
    milestones: Array<{ name: string; confirmed: boolean }>;
    amount: string;
  }>;
}
```

---

## Adapter Implementation Strategy

The architecture moves behind a `ChainAdapter` port interface allowing transparent switching between implementations:

1. **`SimulatedAdapter`**: Horizon-based or in-memory fallback for local dev, testing, and initial deployments without Soroban contracts.
2. **`SorobanAdapter`**: Full Soroban JSON-RPC client interacting with deployed WASM escrow smart contracts.
