# webhooks

**Route prefix:** `/api/webhooks`

**Error prefix:** `ERR_WEBHOOKS_<DESC>` (register in `src/shared/http/errors.ts`)

**Cross-module deps:**
- `src/modules/shipments/`
- `src/modules/telemetry/`

**Conventions:** See root `AGENTS.md` for all hard rules. Update this file manually if the module's dependencies or patterns change.
