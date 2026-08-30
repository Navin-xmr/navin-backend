# Blockchain & escrow integration

This document describes how Navin Backend uses Stellar today (Horizon +
`manageData` emulation) and the roadmap to a real **Soroban escrow contract**
expected by the frontend.

Related issues:

- [#360](https://github.com/Navin-xmr/navin-backend/issues/360) — Soroban escrow contract integration
- [#361](https://github.com/Navin-xmr/navin-backend/issues/361) — On-chain event indexer for settlements / milestones
- [#363](https://github.com/Navin-xmr/navin-backend/issues/363) — Dynamic Stellar / explorer URLs

---

## Current state (Horizon-only fallback)

All on-chain writes go through the Stellar **Horizon** HTTP API via
`@stellar/stellar-sdk` in `src/services/stellar.service.ts`. There is **no**
Soroban RPC client and **no** deployed escrow contract ID in the runtime path
today (env placeholders exist; see below).

| Operation | Function | Mechanism | When |
|-----------|----------|-----------|------|
| Tokenize shipment | `tokenizeShipment` | Horizon `Operation.manageData` for `tracking:{shipmentId}` and `route:{shipmentId}` | Shipment create |
| Anchor telemetry | `anchorTelemetryHash` | Horizon `manageData` + `Memo.hash` | Stellar worker after telemetry ingest |
| Release escrow | `releaseEscrow` | Horizon `manageData` `release:{paymentId}` + memo `escrow-release:…` | Shipment reaches `DELIVERED` |

Config / network:

- `STELLAR_SECRET_KEY` — signing key for the backend account
- `STELLAR_NETWORK` — `testnet` | `public` (selects Horizon network passphrase)
- Horizon server is currently hard-coded to `https://horizon-testnet.stellar.org` in code
- Explorer links: `getStellarExplorerUrl(txHash)` → stellar.expert

### Why this is a fallback

`manageData` entries prove that the backend account recorded an event; they do
**not**:

- Hold or transfer payment value in escrow
- Enforce multi-party confirmations on milestones
- Expose a queryable on-contract state machine the frontend can poll

Escrow “release” today is an audit write, not a fund disbursement.

---

## Gap to Soroban

| Capability | Horizon fallback | Soroban target |
|------------|------------------|----------------|
| Escrow funding / hold | None | Contract holds / tracks escrowed amount |
| Milestone confirmation | Off-chain status + optional ledger block | `confirm_milestone` on-contract |
| Release on delivery | `manageData` release marker | `release` moves funds / finalizes state |
| Read escrow state | DB + payment documents | `get_state` via Soroban RPC |
| Event indexing | N/A | [#361](https://github.com/Navin-xmr/navin-backend/issues/361) indexer |
| Network / explorer URLs | Partially hard-coded | [#363](https://github.com/Navin-xmr/navin-backend/issues/363) dynamic URLs |

Until Soroban lands, keep Horizon paths as the **default fallback** so create /
delivery flows continue to work without `SOROBAN_RPC_URL` or `ESCROW_CONTRACT_ID`.

---

## Target contract methods

The escrow contract (issue [#360](https://github.com/Navin-xmr/navin-backend/issues/360))
should expose at least:

| Method | Purpose |
|--------|---------|
| `initialize` | Create escrow for a shipment (parties, amount, token, milestone schedule) |
| `confirm_milestone` | Record that a lifecycle milestone was confirmed (carrier / oracle / backend) |
| `release` | Release escrowed value to the payee when delivery conditions are met |
| `get_state` | Return current escrow status, confirmed milestones, and balances for UI |

Suggested TypeScript service surface (illustrative):

```ts
interface EscrowContractClient {
  initialize(params: {
    shipmentId: string;
    payer: string;
    payee: string;
    amount: string;
    asset: string;
  }): Promise<{ txHash: string; escrowId: string }>;

  confirmMilestone(params: {
    escrowId: string;
    milestone: string;
    actor: string;
  }): Promise<{ txHash: string }>;

  release(params: {
    escrowId: string;
    shipmentId: string;
  }): Promise<{ txHash: string }>;

  getState(escrowId: string): Promise<{
    status: 'INITIALIZED' | 'IN_PROGRESS' | 'RELEASED' | 'DISPUTED';
    milestones: Array<{ name: string; confirmed: boolean }>;
    amount: string;
  }>;
}
```

Implementation plan (high level):

1. Deploy / register escrow WASM; set `ESCROW_CONTRACT_ID`.
2. Add Soroban RPC client using `SOROBAN_RPC_URL` + network passphrase from `STELLAR_NETWORK`.
3. Wrap Horizon helpers: if Soroban config is present, prefer contract calls; else keep `manageData` fallback.
4. Persist `escrowId` / contract tx hashes on payment / shipment documents.
5. Index contract events ([#361](https://github.com/Navin-xmr/navin-backend/issues/361)) into the ledger / settlements modules.
6. Parameterize Horizon + explorer base URLs ([#363](https://github.com/Navin-xmr/navin-backend/issues/363)).

---

## Environment variables

| Variable | Required for | Description |
|----------|--------------|-------------|
| `STELLAR_SECRET_KEY` | Horizon + Soroban signing | Backend account secret |
| `STELLAR_NETWORK` | Both | `testnet` or `public` |
| `SOROBAN_RPC_URL` | Soroban only | Soroban JSON-RPC endpoint |
| `ESCROW_CONTRACT_ID` | Soroban only | Deployed escrow contract ID (`C…`) |
| `STELLAR_WEBHOOK_SECRET` | Webhooks | HMAC for `POST /api/webhooks/stellar` |

Placeholders already appear in `.env.example` and are mapped in `src/config/index.ts`
as `config.sorobanRpcUrl` / `config.escrowContractId`. They are unused by the
Horizon fallback path today.

---

## Escrow lifecycle (sequence)

```mermaid
sequenceDiagram
  participant Client
  participant API as Navin API
  participant DB as MongoDB
  participant Horizon as Horizon (fallback)
  participant Soroban as Soroban escrow (target)

  Client->>API: POST /api/shipments
  API->>DB: Persist shipment CREATED
  alt Soroban configured
    API->>Soroban: initialize(shipment, parties, amount)
    Soroban-->>API: escrowId + txHash
    API->>DB: Store escrowId / stellarTxHash
  else Horizon fallback
    API->>Horizon: manageData tracking + route
    Horizon-->>API: stellarTokenId + txHash
    API->>DB: Store stellarTokenId / stellarTxHash
  end

  Client->>API: PATCH status (milestones)
  API->>DB: Update status + ledger block
  opt Soroban configured
    API->>Soroban: confirm_milestone(escrowId, milestone)
  end

  Client->>API: PATCH status DELIVERED
  alt Soroban configured
    API->>Soroban: release(escrowId)
    Soroban-->>API: release txHash
  else Horizon fallback
    API->>Horizon: manageData release:{paymentId}
    Horizon-->>API: transactionHash
  end
  API->>DB: Mark settlement / payment released

  Client->>API: GET escrow / settlement detail
  alt Soroban configured
    API->>Soroban: get_state(escrowId)
    Soroban-->>API: status + milestones
  else
    API->>DB: Read payment / shipment fields
  end
  API-->>Client: Envelope with escrow state
```

ASCII equivalent:

```
Shipment created
    │
    ├─[Soroban]─► initialize ──► store escrowId
    └─[Horizon]─► manageData tokenize ──► store stellarTokenId/txHash
    │
Milestone updates
    │
    ├─[Soroban]─► confirm_milestone (optional per status)
    └─[Both]────► DB status + ledger block
    │
Delivered
    │
    ├─[Soroban]─► release
    └─[Horizon]─► manageData release marker
    │
UI / detail
    │
    ├─[Soroban]─► get_state
    └─[Fallback]► payment/shipment documents
```

---

## Operational notes

- Prefer **feature-flagging** on presence of `SOROBAN_RPC_URL` + `ESCROW_CONTRACT_ID`
  rather than a hard cutover so staging can validate the contract while prod keeps
  Horizon until indexer and explorer URL work (#361 / #363) are ready.
- Never log `STELLAR_SECRET_KEY` or raw contract signing payloads.
- Keep response envelopes unchanged; expose new on-chain fields only under
  documented shipment / payment / settlement schemas in `docs/swagger.yaml`.
