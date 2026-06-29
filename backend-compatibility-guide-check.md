# Navin Backend-to-Frontend Compatibility & Review Guide

**Last Verified:** 2026-06-28

This report acts as a comprehensive, structured guide to review the **Navin Backend**'s alignment and readiness to integrate with the **Navin Frontend** codebase. 

Because the frontend is a blockchain-powered logistics platform, it assumes a set of REST endpoints, specific data envelopes, auth interceptors, and blockchain hash references. This document compiles all of these assumptions and introduces a **Percentage Compatibility Scorecard** to quantify the backend's readiness.

---

## 1. Executive Summary & Architecture Overview

The Navin frontend is built using **React 19**, **TypeScript (Strict Mode)**, **Vite**, and **Tailwind CSS**. 

For backend communication:
- **Client**: [Axios](https://github.com/axios/axios) instance configured in [client.ts](../navin-frontend/frontend/src/services/api/client.ts).
- **Base URL**: Set dynamically via `import.meta.env.VITE_API_BASE_URL` (typically `http://localhost:3000/api`).
- **Nesting Consistency Warning**: 
  > [!WARNING]
  > The frontend has minor inconsistencies in its response body expectations. For example, `anomalyApi.getAll` expects a raw response (`res.data`), while most other endpoints expect a nested `{ data: T }` envelope (`res.data.data`). The backend must either match these endpoints exactly or the frontend must be unified.

---

## 2. API Endpoints & Schemas Checklist

Below is the definitive catalog of all endpoints declared in [frontend/src/services/api/endpoints/](../navin-frontend/frontend/src/services/api/endpoints/). The backend must implement these exact signatures and return matching structures to ensure 100% routing and display compatibility.

### 2.1. Authentication Service (`/auth`)
*Service File: [auth.ts](../navin-frontend/frontend/src/services/api/endpoints/auth.ts)*

| Endpoint | Method | Expected Request Body | Expected Response Schema |
| :--- | :--- | :--- | :--- |
| `/auth/signup` | `POST` | `{ email, password, name, organizationId? }` | `{ data: { user: { id, email, name, role }, token } }` |
| `/auth/login` | `POST` | `{ email, password }` | `{ data: { user: { id, email, name, role }, token } }` |
| `/auth/logout` | `POST` | *None* | `void` (200 OK / 204 No Content) |

#### Critical Auth Schema Fields:
```typescript
interface AuthUser {
    id: string;      // Enterprise/user unique identifier
    email: string;
    name: string;
    role: string;    // e.g., "ADMIN", "MANAGER", "CUSTOMER"
}
```

### 2.2. Shipment Service (`/shipments`)
*Service File: [shipments.ts](../navin-frontend/frontend/src/services/api/endpoints/shipments.ts)*

| Endpoint | Method | Expected Query / Body Params | Expected Response Schema |
| :--- | :--- | :--- | :--- |
| `/shipments` | `GET` | **Query**: `{ status?, page?, limit? }` | `{ data: { data: Shipment[], page, limit, total } }` |
| `/shipments/:id` | `GET` | **Path**: `id` | `{ data: Shipment }` |
| `/shipments` | `POST` | **Body**: `{ origin, destination, enterpriseId, logisticsId, milestones?, offChainMetadata? }` | `{ data: Shipment }` |
| `/shipments/:id` | `PATCH` | **Path**: `id`<br>**Body**: `{ offChainMetadata: Record<string, unknown> }` | `{ data: Shipment }` |
| `/shipments/:id/status` | `PATCH` | **Path**: `id`<br>**Body**: `{ status: "CREATED" \| "IN_TRANSIT" \| "DELIVERED" \| "CANCELLED" }` | `{ data: Shipment }` |
| `/shipments/:id/proof` | `POST` | **Form Data**: `file` (File), `notes?` (string)<br>**Header**: `Content-Type: multipart/form-data` | `{ data: Shipment }` |
| `/shipments/:id` | `DELETE` | **Path**: `id` | `void` (200 OK) |

#### Critical Shipment Schema Fields:
```typescript
interface ShipmentMilestone {
    name: string;
    timestamp: string;      // ISO String format
    description?: string;
}

interface Shipment {
    _id: string;
    trackingNumber: string; // Auto-generated on creation or supplied
    origin: string;
    destination: string;
    enterpriseId: string;
    logisticsId: string;
    status: "CREATED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
    milestones: ShipmentMilestone[];
    offChainMetadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
```

### 2.3. Analytics Service (`/analytics`)
*Service File: [analytics.ts](../navin-frontend/frontend/src/services/api/endpoints/analytics.ts)*

| Endpoint | Method | Expected Query Params | Expected Response Schema |
| :--- | :--- | :--- | :--- |
| `/analytics/performance` | `GET` | **Query**: `startDate` (string), `endDate` (string) | `{ data: AnalyticsPerformance }` |

#### Critical Analytics Schema Fields:
```typescript
interface ShipmentsByStatus {
    status: string;
    total: number;
}

interface DeliveryTimeByLogistics {
    logisticsId: string;
    averageDeliveryTimeMs: number;
}

interface AnalyticsPerformance {
    startDate: string;
    endDate: string;
    shipmentsByStatus: ShipmentsByStatus[];
    averageDeliveryTimeByLogisticsId: DeliveryTimeByLogistics[];
    totalDelayedShipments: number;
}
```

### 2.4. Anomalies Service (`/anomalies`)
*Service File: [anomalies.ts](../navin-frontend/frontend/src/services/api/endpoints/anomalies.ts)*

> [!CAUTION]
> Notice that `anomalyApi.getAll` expects `PaginatedAnomalies` in `res.data` directly, without the `{ data: T }` wrapper. Keep this in mind when developing backend models.

| Endpoint | Method | Expected Query Params | Expected Response Schema |
| :--- | :--- | :--- | :--- |
| `/anomalies` | `GET` | **Query**: `{ cursor?, limit?, shipmentId?, severity? }` | `PaginatedAnomalies` *(Unnested!)* |
| `/anomalies/:id/resolve` | `PATCH` | **Path**: `id` | `{ data: Anomaly }` |

#### Critical Anomalies Schema Fields:
```typescript
type AnomalyType = 
    | "TEMPERATURE_EXCEEDED" 
    | "TEMPERATURE_BELOW_MIN" 
    | "HUMIDITY_EXCEEDED" 
    | "HUMIDITY_BELOW_MIN" 
    | "BATTERY_LOW";

type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH";

interface Anomaly {
    _id: string;
    shipmentId: string;
    type: AnomalyType;
    severity: AnomalySeverity;
    message: string;
    timestamp: string;
    resolved: boolean;
    createdAt: string;
    updatedAt: string;
}

interface PaginatedAnomalies {
    data: Anomaly[];
    nextCursor: string | null;
    hasMore: boolean;
}
```

---

## 3. Authentication & Session Flow Integration

### 3.1. Session Token Storage
- Upon a successful `/auth/signup` or `/auth/login`, the frontend extracts `token` and persists it locally:
  ```javascript
  localStorage.setItem("authToken", token);
  ```
- The route guard [ProtectedRoute.tsx](../navin-frontend/frontend/src/components/auth/ProtectedRoute/ProtectedRoute.tsx) evaluates access simply by confirming the presence of this key via [useAuth.ts](../navin-frontend/frontend/src/hooks/useAuth.ts).

### 3.2. Outgoing Request Interception
- All outgoing API requests run through [authInterceptor.ts](../navin-frontend/frontend/src/services/api/interceptors/authInterceptor.ts).
- If `authToken` is present in local storage, it is automatically appended to the headers:
  ```http
  Authorization: Bearer <token>
  ```
- **Backend Requirement**: The backend must expect a `Bearer <token>` token in the `Authorization` header for all protected routes (`/shipments`, `/anomalies`, `/analytics`).

### 3.3. Session Expiration Interception
- The [errorInterceptor.ts](../navin-frontend/frontend/src/services/api/interceptors/errorInterceptor.ts) listens to all response errors.
- If the backend returns a `401 Unauthorized` status code, the frontend interceptor automatically clears the locally stored token and redirects the browser window:
  ```javascript
  localStorage.removeItem("authToken");
  window.location.href = "/login";
  ```
- **Backend Requirement**: Ensure the backend returns exactly `401 Unauthorized` for expired, tampered, or missing tokens to trigger clean client session resets.

---

## 4. Blockchain & Stellar Integration Gaps

As a "blockchain-powered logistics platform", Navin features Stellar on-chain milestones, automated escrow settlements, and freighter wallet integrations. The review revealed critical integration assumptions:

### 4.1. Wallet Connection is Client-Side Only
- The [WalletConnectButton](../navin-frontend/frontend/src/components/auth/WalletConnectButton/WalletConnectButton.tsx) is present in the `Signup.tsx` view and leverages Freighter API (`@stellar/freighter-api`) to read a public key.
- **Architectural Gap**: The `SignupRequest` interface does not capture the wallet's public key during sign-up. 
- **Review Vector**: Does the backend support linking a wallet address post-authentication? The backend user schema should include a `stellarPublicKey: string` field.

### 4.2. On-Chain Contracts vs. REST decoupling
- The frontend **does not** execute Stellar Soroban smart contract calls itself. It relies entirely on mock transactions or backend syncing.
- Pages like [PaymentHistory.tsx](../navin-frontend/frontend/src/pages/Payments/PaymentHistory/PaymentHistory.tsx) and [PaymentStatus.tsx](../navin-frontend/frontend/src/pages/ShipmentDetail/PaymentStatus/PaymentStatus.tsx) expect payment models containing `txHash` or `transactionHash` and status strings (`Pending`, `Escrowed`, `Released`, `Failed`).
- The frontend renders deep-links to:
  `https://stellar.expert/explorer/public/tx/${payment.txHash}` or `https://stellar.expert/explorer/testnet/tx/${payment.transactionHash}`.
- **Backend Requirement**: The backend must serve as the primary engine for the Stellar Soroban transaction operations (e.g. locking funds in escrow when shipment status is set to `IN_TRANSIT`, releasing them upon `DELIVERED`, and posting tx hashes to the database to be retrieved by the frontend).

---

## 5. UI Page Review: Active vs. Mocked Status

While the API service layer is designed, several major pages in the dashboard still rely entirely on mock states and have *no* endpoints wired up. The backend must eventually support these features:

| Tab / Dashboard Page | Frontend Endpoint Status | Missing Endpoint Needs in Backend |
| :--- | :--- | :--- |
| **Logistics Overview** | `MOCKED` *(Hardcoded stats & recent list in page)* | Endpoint to fetch high-level stats cards (active count, delivered count, delays, verification count). |
| **Shipments (History / Details)** | `WIRED` *(to `shipmentApi`)* | CRUD operations on shipments. |
| **Blockchain Ledger** | `MOCKED` *(Placeholder Page)* | Endpoint to read historical Stellar ledger entries matching shipments. |
| **Settlements & Payments** | `MOCKED` *(Placeholder & Client-side list)* | Endpoint to get escrow statuses and a chronological list of token payouts (amount, token type, txHash). |
| **Team Management** | `MOCKED` *(Fully client-side)* | CRUD operations for organizational users, roles, and status changes. |
| **Help Center & Profile** | `MOCKED` *(Visual only)* | Profile updates (name, organization, wallet key binding). |

---

## 6. Compatibility Review Checklist

The backend team can use this checklist to check off completed features during development and trace integration errors.

- [/] **Base Config & CORS**
  - [x] Supports dynamic origins or matches the frontend's dev/prod origins. *(Implemented via env)*
  - [ ] Allows `withCredentials: true` (cookies/headers configuration). *(FAIL: `credentials: true` is missing in `src/config/cors.ts`)*
- [/] **Authentication (`/auth`)**
  - [ ] `/auth/signup` registers accounts and issues valid JWTs. *(FAIL: Zod schema requires `organizationId` but frontend does not send it)*
  - [x] `/auth/login` validates credentials. *(PASS)*
  - [x] `/auth/logout` clean invalidations. *(PASS)*
  - [x] Returns JWTs matching `{ data: { user, token } }` envelope. *(PASS)*
- [/] **Shipment Operations (`/shipments`)**
  - [ ] `/shipments` (GET) supports pagination schema (`page`, `limit`, `total`). *(FAIL: Backend uses cursor-based pagination, while frontend expects page/limit offset pagination and total)*
  - [x] `/shipments/:id` (GET) matches exact single object schema. *(PASS)*
  - [ ] `/shipments/:id/proof` (POST) processes `multipart/form-data` file upload for proof of delivery. *(FAIL: Backend requires `recipientSignatureName` but frontend sends `notes` instead)*
  - [x] `/shipments/:id/status` (PATCH) updates shipment milestone sequences. *(PASS)*
- [/] **Real-time Monitoring & Analytics**
  - [ ] `/anomalies` (GET) supports cursor-based pagination parameters. *(FAIL: Backend wraps response in `data` and `meta`, but frontend expects root keys)*
  - [x] `/anomalies/:id/resolve` (PATCH) updates resolved status. *(PASS)*
  - [x] `/analytics/performance` (GET) aggregates shipment performance indicators by date. *(PASS)*
- [/] **Stellar Ledger Integration**
  - [x] Relays valid Stellar txn hashes (`txHash`) representing escrows and releases to the client. *(Telemetry and Shipment Tokenization on Horizon Testnet are fully implemented! Escrow contract payments are missing).*

---

## 7. Percentage Compatibility Scoring Framework

To arrive at a clear numerical score representing the backend's compatibility, evaluate the backend against the following weighted sections. 

### Compatibility Calculation Formula:
$$\text{Total Compatibility (\%)} = \sum (\text{Component Score} \times \text{Weight})$$

```
+-----------------------------------------------------------------------------------+
| COMPONENT                                  | WEIGHT | SCORE (0 to 1.0) | TOTAL    |
+-----------------------------------------------------------------------------------+
| 1. API Services Layer Alignment            |  40%   |       0.65       |  26.0%   |
| 2. Auth Flow & Interceptor Handling        |  20%   |       1.00       |  20.0%   |
| 3. Data Envelope Envelope Matching (data)  |  15%   |       0.50       |   7.5%   |
| 4. Blockchain/Stellar Hash Orchestration   |  15%   |       0.60       |   9.0%   |
| 5. Standalone UI Page API Mock Gaps        |  10%   |       0.33       |   3.3%   |
+-----------------------------------------------------------------------------------+
| OVERALL SYSTEM COMPATIBILITY               |  100%  |      0.658       |  65.8%   |
+-----------------------------------------------------------------------------------+
```

#### Scoring Rules per Component:
1. **API Services Layer Alignment (40% - Score: 0.65)**:
   - Evaluated 13 REST routes. 8 routes matched exactly. 5 routes had mismatching validation rules or envelope mismatches (Deducted `5 * 0.07 = 0.35`):
     - `/auth/signup` Zod body validation requires `organizationId`.
     - `/shipments` (GET) requires `cursor` and uses cursor pagination instead of offset.
     - `/shipments` (POST) requires `trackingNumber`.
     - `/shipments/:id/proof` (POST) requires `recipientSignatureName` instead of handling optional `notes`.
     - `/anomalies` (GET) returns nested wrapper but client expects root properties.
2. **Auth Flow & Interceptor Handling (20% - Score: 1.00)**:
   - Validates `Bearer` tokens perfectly via `requireAuth` middleware and returns a clean `401` HTTP code upon authentication failure.
3. **Data Envelope Matching (15% - Score: 0.50)**:
   - Mismatches in `/anomalies` envelope wrapping and flat list returned for `/shipments` (GET) trigger severe frontend runtime type-errors. (Deducted `0.5`).
4. **Blockchain/Stellar Hash Orchestration (15% - Score: 0.60)**:
   - Shipment tokenization and telemetry anchoring on Stellar Horizon Testnet are beautifully implemented. However, escrows, settlements, and payment models are entirely un-orchestrated.
5. **Standalone UI Page API Mock Gaps (10% - Score: 0.33)**:
   - User creation and deletion are implemented under the `/api/users` module. However, there is no organizational member list GET endpoint, and Payments and Ledger remain fully mocked.

---

## 8. Detailed Review Findings & Actionable Remediation Steps

### 8.1. The CORS Credentials Block
- **Issue**: The frontend Axios client specifies `withCredentials: true` to support cross-origin sessions, but the backend's [cors.ts](./src/config/cors.ts) returns only `{ origin: true }`.
- **Fix**: Update `src/config/cors.ts` to include `credentials: true` in the returned CORS options:
  ```typescript
  if (allowedOrigins.length === 0 || isAllowedOrigin(requestOrigin, allowedOrigins)) {
    return callback(null, { origin: true, credentials: true });
  }
  ```

### 8.2. Signup Zod Schema Validation Block
- **Issue**: Frontend `Signup.tsx` signs up using only name, email, and password. However, the backend [auth.validation.ts](./src/modules/auth/auth.validation.ts) enforces `organizationId: z.string().min(1)` as a required field.
- **Fix**: Make `organizationId` optional in `auth.validation.ts` so that it doesn't block frontend account creation:
  ```typescript
  export const SignupBodySchema = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(6),
    organizationId: z.string().min(1).optional(), // Make optional
  });
  ```

### 8.3. Create Shipment validation Block
- **Issue**: Frontend `CreateShipment` does not supply `trackingNumber` (leaving the backend to generate it). The backend [shipments.validation.ts](./src/modules/shipments/shipments.validation.ts) makes `trackingNumber: z.string().trim().min(1)` required.
- **Fix**: Make it optional in `shipments.validation.ts`:
  ```typescript
  export const CreateShipmentBodySchema = z.object({
    trackingNumber: z.string().trim().min(1).optional(), // Make optional
    origin: z.string().trim().min(1),
    ...
  });
  ```
  And in `shipments.service.ts`, generate a tracking number if it is missing:
  ```typescript
  const trackingNumber = data.trackingNumber || `NVN-${Math.floor(1000 + Math.random() * 9000)}`;
  const shipment = new Shipment({ ...data, trackingNumber });
  ```

### 8.4. Anomalies Envelope Mismatch
- **Issue**: Frontend expects `/anomalies` to return `PaginatedAnomalies` directly as the root JSON response (i.e. `{ data: Anomaly[], nextCursor: string, hasMore: boolean }`). The backend controller uses `sendResponse` which nests this inside `{ success: true, message: "...", data: Anomaly[], meta: { nextCursor, hasMore } }`.
- **Fix**: Either adjust the frontend service client `anomalyApi.getAll` to parse from `meta` and `data.data`, or alter the backend `getAnomalies` controller to skip the global envelope for that path.
  - **Preferred Backend Fix** (in `anomaly.controller.ts`):
    ```typescript
    res.status(200).json({ data, nextCursor, hasMore });
    ```

### 8.5. Shipment GET Envelope Mismatch
- **Issue**: Frontend `shipmentApi.getAll` expects `res.data.data` to be a paginated object `{ data: Shipment[], page, limit, total }`. The backend `/shipments` (GET) returns a flat array of shipments as `data` and wraps pagination inside `meta` (nextCursor, hasMore).
- **Fix**: Align pagination models. If the frontend is to support infinite scroll, adapt `shipmentApi.getAll` to accept cursor-based responses, or adjust the backend to return an offset pagination object matching the frontend interface.

### 8.6. User List Endpoint (RESOLVED)
- **Status**: ✅ RESOLVED
- **Details**: The backend correctly implements `GET /api/users` route for listing organization members. This endpoint is documented in the Swagger spec and filters users by the authenticated user's `organizationId`. The endpoint supports pagination via `page` and `limit` query parameters and returns users in the expected envelope format.
- **Verification**: Confirmed in both `users.routes.ts` (route definition) and `docs/swagger.yaml` (Swagger documentation).

