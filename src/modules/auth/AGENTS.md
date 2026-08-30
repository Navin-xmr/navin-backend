# auth

**Route prefix:** `/api/auth`

**Error prefix:** `ERR_AUTH_<DESC>` (register in `src/shared/http/errors.ts`)

**Invariants (do not violate):**
- **Signup assigns `VIEWER` unconditionally** (decided 2026-08-25, #147 Option A). Email-domain-based role elevation is forbidden; elevation is invitations-only. Tests asserting otherwise are stale — update them, never the source.
- Access tokens live 7 days; refresh blocklists the old jti. Do not change TTLs without updating `docs/auth-model.md`.

**Cross-module deps:**
- `src/modules/users/`

**Conventions:** See root `AGENTS.md` for all hard rules. Update this file manually if the module's dependencies or patterns change.
