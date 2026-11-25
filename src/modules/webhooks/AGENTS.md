# webhooks

**Route prefix:** `/api/webhooks`

**Error prefix:** `ERR_WEBHOOKS_<DESC>` (register in `src/shared/http/errors.ts`)

**Cross-module deps:**

- `src/modules/shipments/`
- `src/modules/telemetry/`
- `src/infra/redis/` — outbound chain webhook delivery queue

**Conventions:** See root `AGENTS.md` for all hard rules. Update this file manually if the module's dependencies or patterns change.

Outbound chain subscriptions are organization-scoped and admin-managed. The webhook encryption key must be configured before creating a subscription; raw signing secrets are returned only once. The indexer publishes confirmed v1 adapter events (`anchor`, `esc_init`, `esc_rel`) to BullMQ; delivery uses exponential retry and a persistent dead-letter queue.
