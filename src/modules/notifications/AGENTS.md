# notifications

**Route prefix:** `/api/notifications`

**Error prefix:** `ERR_NOTIFICATIONS_<DESC>` (register in `src/shared/http/errors.ts`)

**Cross-module deps:**
None — only imports from `src/shared/` and `src/infra/`.

**External runtime deps:**
`sms-otp.service.ts` dynamically imports `twilio` only when production Twilio credentials are configured.

**Conventions:** See root `AGENTS.md` for all hard rules. Update this file manually if the module's dependencies or patterns change.
