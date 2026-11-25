# Soroban submission operations

## Resource policy

`SorobanAdapter` checks simulation output before assembly or signing. It rejects rather than raises the fee when the minimum resource fee, CPU instructions, or combined ledger disk-read/write bytes exceed a configured ceiling.

| Environment variable               |     Default | Meaning                                                              |
| ---------------------------------- | ----------: | -------------------------------------------------------------------- |
| `SOROBAN_MAX_RESOURCE_FEE_TESTNET` |  `10000000` | Maximum simulated Soroban resource fee on testnet, in stroops        |
| `SOROBAN_MAX_RESOURCE_FEE_PUBLIC`  |   `1000000` | Maximum simulated Soroban resource fee on public network, in stroops |
| `SOROBAN_MAX_CPU_INSTRUCTIONS`     | `100000000` | Maximum CPU instructions per transaction                             |
| `SOROBAN_MAX_LEDGER_BYTES`         |  `40000000` | Maximum combined ledger disk-read and write bytes                    |

These are conservative defaults, not protocol limits. Tune against observed transaction simulations and the organization's approved spend envelope. Apply the same values to API and worker processes; configuration drift can otherwise produce different submission behavior.

## Congestion and over-budget submissions

An over-budget attempt throws `503 ERR_CHAIN_FEE_BUDGET_EXCEEDED` before transaction assembly/signing. It never silently increases its fee. The existing BullMQ anchor job retries transient failures with exponential backoff; repeated failures remain in BullMQ's failed-job store for inspection. Direct API operations surface the typed error (or log a best-effort chain failure where the shipment service deliberately permits off-chain creation).

Search structured logs for `metric=soroban_submission_over_budget_total`. The record includes the network, exceeded resource categories, and simulated usage. Repeated events indicate congestion, a resource-intensive contract change, or ceilings that need a reviewed adjustment. Do not automatically raise production ceilings in response to congestion.
