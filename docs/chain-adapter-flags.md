# Chain Adapter Feature Flags (#1064)

Per-environment selection (simulated → soroban) with a kill switch back to simulated for non-escrow operations. Escrow must never silently fall back to simulated in production.

## Overview

| Concept | Meaning |
|---------|---------|
| **Simulated Adapter** | Horizon manage-data ops; results flagged `simulated: true`; safe for dev/test |
| **Soroban Adapter** | Live contract calls via RPC; production-safe; requires RPC credentials |
| **Feature Flag** | Environment variable `SOROBAN_ADAPTER=simulated\|soroban` |

## Flag Matrix

| NODE_ENV | SOROBAN_ADAPTER | Escrow Mode | Recommended | Notes |
|----------|-----------------|-------------|-------------|-------|
| development | simulated | fallback-safe | ✓ | Fast feedback loops; no RPC needed |
| development | soroban | live | ○ | Testing live integration; requires RPC config |
| test | simulated | fallback-safe | ✓ | E2E test suite; no RPC needed |
| test | soroban | live | ○ | Testing live integration; requires RPC config |
| staging | simulated | fallback-safe | ○ | For testing recovery flows; loses funds in simulated |
| staging | soroban | live | ✓ | Pre-production validation; live escrow testing |
| production | simulated | **FORBIDDEN** | ✗ | Hard error at startup; escrow must never silently fail |
| production | soroban | **REQUIRED** | ✓ | Production must use live escrow; hard-fail on error |

## Behavior

### Environment-Specific Modes

**Dev/Test (simulated mode)**:
- All operations succeed (in-memory stub)
- Results carry `simulated: true`
- Falls back safely if any operation fails

**Dev/Test (soroban mode)**:
- Live RPC calls to Soroban testnet
- Full chain state changes
- Requires `SOROBAN_RPC_URL` and `ESCROW_CONTRACT_ID`

**Staging (simulated mode)**:
- Allowed for testing fallback/recovery logic
- ⚠️ Warning emitted; no funds moved
- Recommended: use soroban instead for realistic integration tests

**Staging (soroban mode)**:
- Recommended for pre-production validation
- Live chain state changes on testnet
- Full escrow semantics

**Production (soroban mode only)**:
- Hard requirement; simulated adapter forbidden at startup
- All escrow operations must succeed on live chain
- No fallback; hard-fail on error → alert operators

### Escrow Hard-Fail Policy

In production with soroban mode:
1. `anchorEvent()` fails → HTTP 502 (on-chain anchor failed)
2. `releaseEscrow()` fails → HTTP 502 (on-chain release failed)
3. No silent fallback to simulated (prevents lost funds)
4. Clients retry; operators receive alerts

In non-production:
1. Escrow failures emit warnings with context
2. May fall back to simulated for testing
3. Loud logging + metrics for observability

### Kill Switch

**To fall back from soroban to simulated in non-production:**

```bash
# Use simulated for recovery / testing
export SOROBAN_ADAPTER=simulated
npm start
```

⚠️ Production (`NODE_ENV=production`) rejects this configuration at startup with:
```
FATAL: SOROBAN_ADAPTER=simulated in production. Escrow operations must use live Soroban contracts (SOROBAN_ADAPTER=soroban).
```

## Configuration

### Development

```bash
# Default: simulated (fastest)
export NODE_ENV=development
export SOROBAN_ADAPTER=simulated  # or omitted (default)
npm start

# Or test live integration
export NODE_ENV=development
export SOROBAN_ADAPTER=soroban
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export ESCROW_CONTRACT_ID=CXXXXXX...
npm start
```

### Staging

```bash
# Recommended: live soroban
export NODE_ENV=staging
export SOROBAN_ADAPTER=soroban
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export ESCROW_CONTRACT_ID=CXXXXXX...
npm start
```

### Production

```bash
# Required: soroban adapter only
export NODE_ENV=production
export SOROBAN_ADAPTER=soroban
export SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
export ESCROW_CONTRACT_ID=CXXXXXX...
export STELLAR_SECRET_KEY=SXXXXXX...
npm start

# This will fail at startup:
export NODE_ENV=production
export SOROBAN_ADAPTER=simulated
npm start
# ERROR: FATAL: SOROBAN_ADAPTER=simulated in production...
```

## Testing

### Validate Flag Configuration

```bash
npm test -- tests/chain.adapter-flags.test.ts
```

### Test Flag Combinations

Matrix test verifies all 8 combinations (dev/test/staging/prod × simulated/soroban) respect the hard-fail rule:

```bash
npm test -- tests/chain.adapter-flags.test.ts --testNamePattern="Flag Matrix"
```

## Observability

When escrow operations fall back to simulated (non-prod only):

```json
{
  "level": "WARN",
  "message": "⚠️ ESCROW FALLBACK: Operation fell back to simulated adapter. No on-chain state change.",
  "context": "releaseEscrow",
  "id": "payment-abc123",
  "env": "staging",
  "adapter": "simulated"
}
```

In production + soroban mode, failures emit HTTP 502 and trigger alerts (no fallback).

## See Also

- `src/shared/flags/chain-adapter.flags.ts` — Implementation
- `src/config/index.ts` — Config loading
- `src/env.schema.ts` — Environment variable validation
- `docs/chain-interface.md` — Chain adapter spec
