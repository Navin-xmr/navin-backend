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

## 3. Database Indexing Strategy

Indexing is critical for high-performance retrieval, especially for real-time telemetry and shipment tracking. We follow these indexing principles:

- **Compound Indexes**: Constructed based on query patterns. The most selective fields come first (e.g., `shipmentId`), followed by sorting fields (e.g., `timestamp` or `createdAt` descending), and lastly, pagination markers (like `_id` descending for deterministic keyset pagination).
- **Text Indexes**: Applied to locations/addresses (like origin and destination in the Shipment schema) to allow flexible text search over string values.
- **Single-Field Indexes**: Automatically created for unique identifier lookup keys like `keyHash` in ApiKey, `email` in User, and `trackingNumber` in Shipment.

### Key Index Reference:

| Model         | Index Definition                                | Query Pattern Optimized                                                      |
| ------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| **Shipment**  | `{ status: 1, createdAt: -1 }`                  | Filtering shipments by current operational status, sorted newest first.      |
| **Shipment**  | `{ enterpriseId: 1, createdAt: -1 }`            | Customer dashboard filtering for an enterprise shipper, sorted newest first. |
| **Shipment**  | `{ logisticsId: 1, createdAt: -1 }`             | Carrier dashboard filtering for a logistics provider, sorted newest first.   |
| **Shipment**  | `{ createdAt: -1, _id: -1 }`                    | Deterministic pagination for general shipment lists.                         |
| **Shipment**  | `{ origin: 'text', destination: 'text' }`       | Free-text search for origin/destination locations.                           |
| **Telemetry** | `{ shipmentId: 1, timestamp: -1 }`              | Live telemetry chart rendering for a specific shipment.                      |
| **Telemetry** | `{ sensorId: 1, shipmentId: 1, timestamp: -1 }` | Querying specific IoT sensor telemetry records for a shipment.               |
| **Anomaly**   | `{ shipmentId: 1, timestamp: -1, _id: -1 }`     | Listing anomalies for a shipment with deterministic pagination.              |
| **Anomaly**   | `{ resolved: 1, timestamp: -1, _id: -1 }`       | Unresolved anomaly dashboard views.                                          |
| **Payment**   | `{ organizationId: 1, createdAt: -1 }`          | Financial ledger and invoicing lists for an organization.                    |

---

## 4. Schema Conventions & Guardrails

To prevent NoSQL injections, data corruption, and unauthorized leaks:

- **Strict Mode**: All schemas enforce `strict: true` or default mongoose strict parsing to prevent arbitrary schema modifications/pollution.
- **Password Sanitization**: Sensitive authentication details (e.g., `passwordHash`) are removed during document serialization (`toJSON` configuration overrides and custom `toJSON` method blocks in the User Schema).
- **No Raw Query spreads**: Rest/Spread query operations (e.g., `...req.query`) must never be passed directly into Mongo query filters to prevent NoSQL injection vectors.
- **Date Uniformity**: All date fields must default to UTC and be formatted uniformly via `isoDatePlugin` before reaching the API layer.
