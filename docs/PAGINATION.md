# Pagination Convention

Navin Backend uses **two pagination strategies**. Pick one per endpoint and keep
pagination fields exclusively in the response `meta` object (never nested in `data`).

## Strategy selection

| Strategy | Query params | `meta` shape | Use when |
|----------|--------------|--------------|----------|
| **Cursor** | `cursor`, `limit` | `{ nextCursor, hasMore }` | Large / append-only collections: **telemetry**, **anomalies**, **payments**, **audit logs**, **shipment timeline**, **users** |
| **Offset** | `page`, `limit` | `{ page, limit, total }` | Bounded admin lists: **shipments**, **users** |

> **Payments variance (documented):** `GET /api/payments` and `GET /api/settlements`
> always include `total` in `meta` — even in cursor mode. This is a deliberate deviation;
> clients may read `total` for display but must page via `nextCursor` / `hasMore`.

Shared helpers live in `src/shared/utils/pagination.ts`.

## Cursor-based

```http
GET /api/telemetry?limit=20
GET /api/telemetry?limit=20&cursor=<nextCursor>
```

```json
{
  "success": true,
  "message": "Telemetry retrieved",
  "data": [ /* items */ ],
  "meta": {
    "nextCursor": "507f1f77bcf86cd799439011",
    "hasMore": true
  }
}
```

- Pass `meta.nextCursor` as `cursor` to fetch the next page.
- When `hasMore` is `false`, `nextCursor` is `null`.
- Do **not** combine `cursor` and `page` on telemetry (Zod rejects this).

### Dual-mode rule (telemetry & users)

`GET /api/telemetry` and `GET /api/users` accept both cursor and offset (`page`):

1. Prefer **cursor** for all new clients.
2. `page` alone remains supported for offset paging (users) / legacy dashboards (telemetry).
3. Sending **both** `cursor` and `page` is a **400** validation error.

## Offset-based

```http
GET /api/shipments?page=1&limit=20
```

```json
{
  "success": true,
  "message": "Shipments retrieved",
  "data": [ /* items */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

## Frontend contract checklist

1. Read list items from `data` (always an array for list endpoints).
2. Read pagination only from `meta`.
3. Use cursor flow for telemetry / anomalies / payments / shipment timeline / users.
4. Use page/limit/total for shipments and offset mode of users.
5. Never send `cursor` and `page` together on telemetry or users.
6. `GET /api/payments` / `GET /api/settlements` always include `total` in `meta` even in
   cursor mode (documented deviation).
