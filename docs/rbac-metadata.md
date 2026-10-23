# RBAC Matrix — Route Metadata Derivation (P5-04 / P7-32)

## Problem

`tests/rbac.matrix.test.ts` hand-duplicated `requireRole` config (the `RBAC_MATRIX`
const) and redeclared `UserRole` locally. Both were drift-prone: a change to any
`requireRole(...)` call in a route file wouldn't be caught until a manual inspection.

## Solution (implemented — #710)

Each route module now exports a `routeRoles` const that lists exactly the roles
passed to `requireRole()` for the routes covered by the matrix test:

```ts
// src/modules/shipments/shipments.routes.ts
export const routeRoles = {
  'GET /api/shipments':        [UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER],
  'GET /api/shipments/:id':    [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER],
  'POST /api/shipments':       [UserRole.ADMIN, UserRole.MANAGER],
  'PATCH /api/shipments/:id':  [UserRole.ADMIN, UserRole.MANAGER],
  'DELETE /api/shipments/:id': [UserRole.ADMIN, UserRole.MANAGER],
} as const;
```

`tests/rbac.matrix.test.ts` imports and aggregates them:

```ts
import { UserRole }      from '../src/shared/constants/index.js';
import { routeRoles as shipmentRoles }  from '../src/modules/shipments/shipments.routes.js';
import { routeRoles as userRoles }      from '../src/modules/users/users.routes.js';
import { routeRoles as analyticsRoles } from '../src/modules/analytics/analytics.routes.js';
import { routeRoles as anomalyRoles }   from '../src/modules/anomaly/anomaly.routes.js';

const RBAC_MATRIX = {
  ...userRoles,
  ...shipmentRoles,
  ...analyticsRoles,
  ...anomalyRoles,
  // Telemetry GET has no requireRole — all authenticated roles may access.
  'GET /api/telemetry': [ /* all 5 roles */ ],
  // Sentinels for public / API-key routes
  'GET /api/health':         ['PUBLIC'],
  'POST /api/webhooks/iot':  ['API_KEY'],
};
```

This makes `requireRole()` and the test matrix the **same declaration** —
drift is impossible as long as the route file is the authoritative source.

## Modules that export routeRoles (as of #710)

| Module | File |
|--------|------|
| Shipments | `src/modules/shipments/shipments.routes.ts` |
| Users | `src/modules/users/users.routes.ts` |
| Analytics | `src/modules/analytics/analytics.routes.ts` |
| Anomaly | `src/modules/anomaly/anomaly.routes.ts` |

All other modules are hand-maintained in the test until their routes are added
to this pattern (tracked in TODO G6).

## Review checklist guard (drift prevention)

When editing `requireRole(...)` in any of the modules above:

- [ ] Update the corresponding `routeRoles` entry in the same file
- [ ] Run `npm test -- tests/rbac.matrix.test.ts` — should be green
- [ ] If a new route is added to the matrix, add its entry to `routeRoles` and
      add the corresponding `describe` block to the test

## Quality gates

- `npm run lint` (extended scope covering `tests/**`) green
- `npm test -- tests/rbac.matrix.test.ts` green
- Matrix derived from route-module exports, no hand-duplicated const

Related: #616, #710
