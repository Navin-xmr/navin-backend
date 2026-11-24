# Chain v2 schema coverage (#1057)

Target: `src/shared/types/chain.ts` (spec `2.0.0`).

Suite: `tests/chain.v2.schemas.test.ts` (table-driven round-trip + mutation) and
`tests/chain.confirmations.test.ts` (depth fixtures 0/2/3/10).

Generate a fresh report with:

```bash
npm run test:chain:schemas
```

## Coverage matrix

| Schema group                        | Positive case               | Missing field | Wrong type | Extra field | Bad enum/format                                               |
| ----------------------------------- | --------------------------- | ------------- | ---------- | ----------- | ------------------------------------------------------------- |
| `AnchorArgsSchema`                  | fixture round-trip          | ✓             | ✓          | ✓           | symbol / address / hash                                       |
| `InitEscrowArgsSchema`              | fixture round-trip          | ✓             | ✓          | ✓           | amount / token + `payer ≠ payee`                              |
| `ReleaseEscrowArgsSchema` (v2)      | fixture round-trip          | ✓             | ✓          | ✓           | `caller` strkey / `shipment_id` symbol; legacy shape rejected |
| `ChainTxResultSchema`               | fixture round-trip          | ✓             | ✓          | ✓           | ledger bounds                                                 |
| `AnchorEventSchema`                 | fixture + `parseChainEvent` | ✓             | ✓          | ✓           | topic/data tuple mismatch                                     |
| `EscrowInitEventSchema`             | fixture + `parseChainEvent` | ✓             | ✓          | ✓           | tuple mismatch                                                |
| `EscrowReleaseEventSchema`          | fixture + `parseChainEvent` | ✓             | ✓          | ✓           | tuple mismatch                                                |
| `ChainContractErrorSchema`          | all 9 fixtures              | ✓             | ✓          | ✓           | unknown code / unknown function                               |
| `ChainEventVerificationSchema` (v2) | 0/2/3/10 depths             | ✓             | ✓          | ✓           | negative / fractional / string `verified`                     |

## Notes

- Every schema is `.strict()`: an unknown field fails, which is the spec-drift guard.
- `chainErrorToAppError` maps all nine contract discriminants to registered `ERR_CHAIN_*`
  codes; unknown codes fall back to `ERR_CHAIN_UNKNOWN` (502).
- v2 escrow errors `InvalidStatus` (409) and `NotAuthorized`/Unauthorized (403) are asserted
  explicitly.
