# Prompt: Fix a TypeScript build error

## Context
The TypeScript compiler reports one or more errors in the codebase.

## Instructions

1. **Read the exact error** — Note the file, line, and error code (e.g., `TS2307`, `TS2353`).
2. **Do not assume the cause** — Read the affected file and its imports.
3. **Categorize the error**:
   - **Missing dependency** (`TS2307 Cannot find module`): Check `package.json` first. If the package is listed but not installed locally, treat it as environmental (document only). If the package is not listed, add it.
   - **Type mismatch** (`TS2353`, `TS2345`, `TS2322`): Fix the code. Do not use `as any`. Narrow the type or update the interface.
   - **Duplicate identifier** (`TS2300`): Remove the duplicate import or declaration.
   - **Missing declaration** (`TS7016`): Add `@types/xxx` or create a minimal `.d.ts` file.
4. **Prefer minimal diffs** — One concern per edit.
5. **Verify** — After fixing, mentally verify the type-check path.
6. **Update docs** — If the fix reveals a new convention, update the relevant `AGENTS.md`.

## Output format
Return the file:line of each fix and a one-sentence explanation. Do not dump full file contents unless asked.
