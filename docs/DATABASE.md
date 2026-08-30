# Navin Backend — Database Documentation & Schema Design Decisions

This document outlines the architecture, conventions, and database design decisions for the MongoDB database layer powered by Mongoose in the Navin backend.

---

## 1. Mongoose Plugins Overview

To maintain consistency and reduce code duplication across models, we utilize custom reusable Mongoose plugins:

### `isoDatePlugin`

- **Path**: [`src/shared/plugins/isoDatePlugin.ts`](file:///workspaces/navin-backend/src/shared/plugins/isoDatePlugin.ts)
- **Purpose**: Converts dates to ISO 8601 UTC strings in JSON output.
- **Mechanism**: Intercepts the schema's `toJSON` serialization (which is invoked during API response serializations like `res.json()`). It recursively walks the serializing object and converts any `Date` instance into its string format representation (e.g. `2026-04-25T11:00:00.000Z`).
- **Usage**: Applied globally to all schemas (e.g., `ShipmentSchema.plugin(isoDatePlugin)`).

### `softDeletePlugin`

- **Path**: [`src/shared/plugins/softDeletePlugin.ts`](file:///workspaces/navin-backend/src/shared/plugins/softDeletePlugin.ts)
- **Purpose**: Adds the `deletedAt` field and handles soft-delete queries.
- **Mechanism**: Adds a `deletedAt: { type: Date, default: null }` field to the schema. Registers pre-query hooks to filter out soft-deleted documents automatically.
- **Usage**: Can be applied to schemas requiring soft-delete capabilities. Currently, models implement this hook pattern natively or via a plugin:

  ```typescript
  // Soft delete hooks
  schema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
    this.where({ deletedAt: null });
  });

  schema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { deletedAt: null } });
  });
  ```

---

## 2. Soft-Delete Lifecycle

Soft-delete prevents data loss, retains historical shipping and telemetry logs for auditing, and keeps data queryable for archive purposes.

### Lifecycle Phases:

1. **Create** (Active State)
   - Documents are created with `deletedAt: null`.
2. **Soft-Delete** (Suspended State)
   - Instead of using `deleteOne` or `deleteMany`, the document's `deletedAt` field is set to the current date/time (e.g. `new Date()`).
   - Query filters (`pre-find`, `pre-findOne`, etc.) automatically exclude these records.
   - Aggregate stages (`pre-aggregate`) prepend a `$match: { deletedAt: null }` stage, excluding deleted records.
3. **Cleanup & Archival** (Terminal State)
   - A background maintenance worker or script periodically runs queries overriding the default soft-delete query filter (using Mongoose bypasses or direct mongo collection queries) to permanently delete/prune old soft-deleted records older than the retention threshold.

---

## 3. Migrations Workflow

Schema migrations are handled by [migrate-mongo](https://www.npmjs.com/package/migrate-mongo) (v11). The setup lives in [`migrate-mongo.config.cjs`](../migrate-mongo.config.cjs): it reads the connection string from `MONGO_URI`, points at the `migrations/` directory, and records applied migrations in the `changelog` collection.

### Available Scripts

| Command                 | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `npm run migrate:up`    | Applies all pending migrations in `migrations/`, in name order.  |
| `npm run migrate:down`  | Rolls back the most recently applied migration.                 |
| `npm run migrate:status`| Lists each migration with its applied/pending state.            |

### Workflow

1. Add a new file in `migrations/` using the `YYYYMMDDHHmmss-description.js` convention. Each file exports `up(db)` and `down(db)` and operates on raw collection handles.
2. Inspect the pending set with `npm run migrate:status`.
3. Apply with `npm run migrate:up`; roll back with `npm run migrate:down` if needed.

> **Note:** Migrations are not wired into the app entrypoint or Docker Compose — they must be run manually or via a one-shot service (see TODO H2.1).

### Current Migrations

| Migration                                 | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `20240101000000-add-compound-indexes.js`  | Creates compound indexes on `shipments`, `anomalies`, `telemetries`, and `apikeys`, mirroring the schema-level declarations below. |

---

## 4. Database Indexing Strategy

Indexing is critical for high-performance retrieval, especially for real-time telemetry and shipment tracking. We follow these indexing principles:

- **Compound Indexes**: Constructed based on query patterns. The most selective fields come first (e.g., `shipmentId`), followed by sorting fields (e.g., `timestamp` or `createdAt` descending), and lastly, pagination markers (like `_id` descending for deterministic keyset pagination).
- **Text Indexes**: Applied to locations/addresses (like origin and destination in the Shipment schema) to allow flexible text search over string values.
- **Single-Field Indexes**: Automatically created for unique identifier lookup keys like `keyHash` in ApiKey, `email` in User, and `trackingNumber` in Shipment.

### Key Index Reference:

| Model           | Index Definition                                          | Query Pattern Optimized                                                      |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Shipment**    | `{ status: 1, createdAt: -1 }`                            | Filtering shipments by current operational status, sorted newest first.      |
| **Shipment**    | `{ enterpriseId: 1, createdAt: -1 }`                      | Customer dashboard filtering for an enterprise shipper, sorted newest first. |
| **Shipment**    | `{ logisticsId: 1, createdAt: -1 }`                       | Carrier dashboard filtering for a logistics provider, sorted newest first.   |
| **Shipment**    | `{ createdAt: -1, _id: -1 }`                              | Deterministic pagination for general shipment lists.                         |
| **Shipment**    | `{ trackingNumber: 'text', origin: 'text', destination: 'text' }` | Free-text search across tracking number and origin/destination locations.    |
| **Telemetry**   | `{ shipmentId: 1, timestamp: -1 }`                        | Live telemetry chart rendering for a specific shipment.                      |
| **Telemetry**   | `{ sensorId: 1, shipmentId: 1, timestamp: -1 }`           | Querying specific IoT sensor telemetry records for a shipment.               |
| **Telemetry**   | `{ anchorStatus: 1 }`                                     | Filtering telemetry by anchoring status in the Stellar anchoring workflow.   |
| **Anomaly**     | `{ shipmentId: 1, timestamp: -1, _id: -1 }`               | Listing anomalies for a shipment with deterministic pagination.              |
| **Anomaly**     | `{ resolved: 1, timestamp: -1, _id: -1 }`                 | Unresolved anomaly dashboard views.                                          |
| **Anomaly**     | `{ severity: 1, timestamp: -1, _id: -1 }`                 | Filtering anomalies by severity, sorted newest first with deterministic pagination. |
| **Anomaly**     | `{ severity: 1, shipmentId: 1, timestamp: -1, _id: -1 }`  | Filtering anomalies by severity within a shipment (e.g., critical shipment anomalies). |
| **ApiKey**      | `{ keyHash: 1 }`                                          | Unique lookup by hashed API key during authentication.                       |
| **ApiKey**      | `{ organizationId: 1 }`                                   | Listing an organization's API keys.                                          |
| **ApiKey**      | `{ shipmentId: 1 }`                                       | Finding API keys scoped to a specific shipment.                              |
| **LedgerBlock** | `{ shipmentId: 1, milestoneEvent: 1, createdAt: -1 }`     | Querying ledger blocks for a shipment, newest first.                         |
| **LedgerBlock** | `{ eventType: 1, createdAt: -1 }`                         | Filtering ledger blocks by event type across shipments.                      |
| **Payment**     | `{ organizationId: 1, createdAt: -1 }`                    | Financial ledger and invoicing lists for an organization.                    |

> **Planned (K3):** once `dataHash` lands on `LedgerBlock` as part of the event-driven indexer, expect a `{ dataHash: 1 }` index (plus unique constraint) to support verification lookups.

---

## 5. Schema Conventions & Guardrails

To prevent NoSQL injections, data corruption, and unauthorized leaks:

- **Strict Mode**: All schemas enforce `strict: true` or default mongoose strict parsing to prevent arbitrary schema modifications/pollution.
- **Password Sanitization**: Sensitive authentication details (e.g., `passwordHash`) are removed during document serialization (`toJSON` configuration overrides and custom `toJSON` method blocks in the User Schema).
- **No Raw Query spreads**: Rest/Spread query operations (e.g., `...req.query`) must never be passed directly into Mongo query filters to prevent NoSQL injection vectors.
- **Date Uniformity**: All date fields must default to UTC and be formatted uniformly via `isoDatePlugin` before reaching the API layer.
