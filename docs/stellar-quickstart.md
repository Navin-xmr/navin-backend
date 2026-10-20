# Stellar Quickstart Nightly Test Harness

---

## Standalone Stellar Quickstart Harness (`#806` / `P6-19`)

To run `SorobanAdapter` and `stellar-indexer.worker` integration tests locally or in the nightly CI harness without external internet or public testnet dependency, use the standalone `stellar/quickstart` container.

### 1. Start the Standalone Quickstart Container

Using the `quickstart` profile in `docker-compose.yml` or the `docker-compose.quickstart.yml` override:

```bash
# Start only the standalone Stellar node (Horizon + Soroban RPC + Friendbot on :8000)
docker compose --profile quickstart up -d stellar-quickstart

# Or boot the full compose stack wired to the local quickstart container
docker compose -f docker-compose.yml -f docker-compose.quickstart.yml up -d
```

### 2. Verify Standalone Soroban RPC & Horizon Health

Before executing integration tests, run the health verification step to confirm that both Soroban JSON-RPC (`getHealth` → `"healthy"` with `latestLedger >= 1`) and Horizon HTTP root (`Standalone Network ; February 2017`) are ready:

```bash
node scripts/stellar-quickstart-health.mjs
```

### 3. Local Developer Endpoints & Environment Variables

| Endpoint / Variable | Value |
|---------------------|-------|
| `HORIZON_URL` | `http://127.0.0.1:8000` |
| `SOROBAN_RPC_URL` | `http://127.0.0.1:8000/soroban/rpc` |
| `Friendbot` | `http://127.0.0.1:8000/friendbot?addr=<G...>` |
| Network Passphrase | `Standalone Network ; February 2017` |


