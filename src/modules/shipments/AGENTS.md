# shipments

**Route prefix:** `/api/shipments`

**Error prefix:** `ERR_SHIPMENTS_<DESC>` (register in `src/shared/http/errors.ts`)

**Cross-module deps:**
- `src/modules/payments/`
- `src/services/chain/` — `factory.ts` (`getChainAdapter`) + port types only (escrow release on delivery)

**Conventions:** See root `AGENTS.md` for all hard rules. Update this file manually if the module's dependencies or patterns change.
