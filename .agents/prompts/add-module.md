# Prompt: Add a new domain module

## Context
You are creating a new self-contained domain module under `src/modules/<domain>/`.

## Instructions

1. **Copy the template** — Duplicate `src/modules/__template__/` to `src/modules/<domain>/` and adapt file names and content.
2. **Read** root `AGENTS.md` § Architecture Boundaries to confirm your module's allowed dependencies.
3. **Adapt the template** — Replace placeholder names, types, and business rules with the new domain's concepts.
4. **Register the router** — Import and mount the new router in `src/app.ts` at the appropriate path.
5. **Register error codes** — Add domain-specific codes to `src/shared/http/errors.ts` following `ERR_<DOMAIN>_<DESC>`.
6. **Create tests** — Write tests in `tests/` covering 200 · 401 · 403 · 400.
7. **Swagger** — Add all new paths to `docs/swagger.yaml`.
8. **Create module docs** — Write `src/modules/<domain>/AGENTS.md` with the route prefix, file patterns, error code pattern, and dependencies.
9. **Update root docs** — Add the module to root `AGENTS.md` § Architecture Boundaries (even if it has no cross-module deps).
10. **Run skills** — Cross-Check → Cleanup → Document.

## Output format
Return the list of created files and the route prefix. Do not dump full file contents unless asked.
