# Testnet deployment runbook (P15-01)

All deployed contract IDs live in the committed registry
[`config/contract-registry.json`](../config/contract-registry.json). It is the
single source of truth: `src/config/contractRegistry.ts` resolves IDs from it at
startup and rejects any `ESCROW_CONTRACT_ID` that does not match. Do not supply
ad-hoc IDs via `.env` for a deployment — add the deployment to the registry in
the same commit that deploys the WASM.

## Prerequisites

- `STELLAR_SECRET_KEY` for a funded testnet deployer account.
- `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`,
  `HORIZON_URL=https://horizon-testnet.stellar.org`, `STELLAR_NETWORK=testnet`.
- Built WASM artifacts from the contract repo pinned at `sourceCommit`.

## Deploy → init → verify

```bash
# 1. Deploy (run from the contract repo at the commit recorded in the registry)
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/shipment.wasm \
  --source "$STELLAR_SECRET_KEY" --network testnet --alias shipment-testnet
# Repeat for token and nft. Capture each C... ID and the WASM hash:
sha256sum target/wasm32-unknown-unknown/release/shipment.wasm

# 2. Initialize each contract (example: shipment escrow)
stellar contract invoke --id "$SHIPMENT_ID" --source "$STELLAR_SECRET_KEY" \
  --network testnet -- initialize --admin "$ADMIN_ADDRESS"

# 3. Record the deployment in config/contract-registry.json:
#    networks.testnet.contracts.shipment.id = $SHIPMENT_ID
#    networks.testnet.contracts.shipment.wasmHash = <sha256 of WASM>
#    networks.testnet.sourceCommit = <git rev-parse HEAD of contract repo>
git add config/contract-registry.json && git commit -m "ops: register testnet contracts"

# 4. Verify startup configuration (mismatch exits non-zero)
SOROBAN_ADAPTER=soroban ESCROW_CONTRACT_ID="$SHIPMENT_ID" npm run build
npm test -- config/contract-registry.test.ts

# 5. Verify a live transaction against the registered deployment
stellar contract invoke --id "$SHIPMENT_ID" --source "$STELLAR_SECRET_KEY" \
  --network testnet -- get_state --shipment_id test-shipment-1
# Expected output: a JSON state object with status and milestone fields.
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' "$SOROBAN_RPC_URL"
# Expected output: {"jsonrpc":"2.0","id":1,"result":{"id":...}}
```

A startup mismatch fails with
`Configured shipment contract ID ... does not match testnet registry entry ...`.
Never bypass it by editing env values; update the registry with the new
deployment and commit first.

For public mainnet, add a `public` entry with the exact same schema, a real
40-hex `sourceCommit`, and non-empty IDs/hashes before enabling
`STELLAR_NETWORK=public`. A placeholder (`""`) entry is intentionally rejected
by configured-ID verification.
