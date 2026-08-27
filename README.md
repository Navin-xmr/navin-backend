# Navin Backend

[![CI](https://github.com/Navin-xmr/navin-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Navin-xmr/navin-backend/actions/workflows/ci.yml)

**Navin** is a blockchain-powered logistics platform that improves supply chain visibility for enterprises through tokenized shipments, immutable milestone tracking, and automated settlements.
By creating a zero-trust interface between logistics providers and their clients, Navin aims to ensure both parties access identical real-time data — removing information asymmetry and enabling seamless, dispute-free operations.

The backend service powers the off-chain layer of the platform, handling API logic, data aggregation, real-time streaming, and Stellar blockchain anchoring.

> **Chain integration status:** shipment/telemetry hashes are anchored on-chain today via Horizon transactions. Soroban smart-contract integration (hash-and-emit events, escrow) is being co-designed with the [navin-contracts](https://github.com/Navin-xmr/navin-contracts) repo — settlement flows are currently simulated placeholders. See `TODO.md` Part 3.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [API Response Envelope](#api-response-envelope)
- [Pagination](#pagination)
- [Error Handling](#error-handling)
- [Real-time Features](#real-time-features)
- [Available Endpoints](#available-endpoints)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Contributing](#contributing)

---

## Quick Start

Get the Navin Backend running in **less than 5 minutes**:

```bash
# 1. Clone the repository
git clone https://github.com/Navin-xmr/navin-backend.git
cd navin-backend

# 2. Install dependencies (reproducible clean install)
npm ci

# 3. Create environment file
cp .env.example .env
# A development JWT_SECRET is pre-filled in .env.example.
# Edit MONGO_URI if your MongoDB is not on the default localhost:27017.

# 4. Start MongoDB and Redis (required — Redis powers queues, SSE and caches)
docker run -d -p 27017:27017 --name navin_mongo mongo:6.0
docker run -d -p 6379:6379 --name navin_redis redis:7-alpine

# 5. Start the development server (with hot reload)
npm run dev

# Expected output:
# info: HTTP server listening port=3000
```

The API is now available at `http://localhost:3000/api`.

### Docker Compose (mongo + redis + app)

The compose stack boots the API in **production mode** (see `ENV NODE_ENV=production` in the `Dockerfile` runner stage). For hot-reload local development, use `npm run dev` with `.env` instead.

```bash
# Optional: override secrets from a local env file (recommended)
cp .env.example .env
# JWT_SECRET in .env.example is already ≥32 characters (required by src/env.ts)

docker compose up -d --build
docker compose logs -f app   # expect: HTTP server listening
curl http://localhost:3000/api/health
docker compose exec app whoami   # node (non-root runner)
```

- **JWT_SECRET:** must be at least 32 characters. Compose provides a dev default; override via `.env` or `JWT_SECRET=... docker compose up`.
- **Startup order:** `app` waits for healthy `mongo` and `redis` before starting.
- **Clean reset:** `docker compose down -v && docker compose up -d --build`

### Verify Installation

```bash
# Check health endpoint (no auth required)
curl http://localhost:3000/api/health

# Expected response:
# { "success": true, "message": "OK", "data": { "status": "active", "uptime": 123, "timestamp": "2026-06-28T..." } }
```

---

## Authentication

The Navin Backend uses **JWT (JSON Web Tokens)** for stateless authentication. All protected endpoints require a valid bearer token.

### 1. Sign Up (Create Account)

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "name": "John Doe",
    "password": "SecurePass123"
  }'

# Response:
# {
#   "success": true,
#   "message": "Account created successfully",
#   "data": {
#     "user": {
#       "id": "507f1f77bcf86cd799439011",
#       "email": "user@example.com",
#       "name": "John Doe",
#       "role": "VIEWER"
#     },
#     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
#   }
# }
```

### 2. Login (Authenticate)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123"
  }'

# Response: { "success": true, "data": { "user": {...}, "token": "eyJhbGciOi..." } }
```

### 3. Using Your Token

Store the `token` and include it in all subsequent requests:

```bash
# Example: List shipments
curl -X GET http://localhost:3000/api/shipments \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# If token is missing or invalid, you'll receive:
# { "success": false, "message": "Missing or invalid token", "data": null, "error": { "code": "ERR_AUTH_INVALID" } }
```

### 4. Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <your_token>"

# Response: { "success": true, "message": "Logged out successfully", "data": null }
```

### JWT Expiration

Access tokens expire after **7 days** by default. When expired, the API returns:

```json
{
  "success": false,
  "message": "Token has expired",
  "data": null,
  "error": { "code": "ERR_AUTH_INVALID" }
}
```

**Action**: Redirect user to login page. A `POST /api/auth/refresh` endpoint exists for session continuation; see [docs/swagger.yaml](docs/swagger.yaml) for its contract.

### Role-Based Access Control (RBAC)

User roles determine which endpoints they can access:

| Role | Permission Level | Typical Use Case |
|------|---|---|
| `SUPER_ADMIN` | Full system access | Internal DevOps, system administration |
| `ADMIN` | Organization administration | Company managers, billing access |
| `MANAGER` | Shipment & analytics management | Logistics coordinators |
| `VIEWER` | Read-only access | Auditors, read-only dashboards |
| `DRIVER` | Field operator (invitable today) | Drivers — assignable via invitations; no role-guarded routes yet |
| `CUSTOMER` | Minimal read access | External parties (tracking only) |

> Signup always assigns `VIEWER`; elevated roles are granted via invitations (`POST /api/users/invitations`) — never self-declared.

If your role lacks permissions, you'll receive:

```json
{
  "success": false,
  "code": "ERR_PERMISSION_DENIED",
  "message": "Insufficient permissions for this operation"
}
```

---

## API Response Envelope

Every successful API response follows this standard format:

### Successful Response (2xx)

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Example Shipment",
    "status": "IN_TRANSIT"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

### Error Response (4xx, 5xx)

```json
{
  "success": false,
  "message": "Human-readable error description",
  "data": null,
  "error": {
    "code": "ERR_VALIDATION_FAILED"
  },
  "details": [
    { "path": "email", "message": "Invalid email address", "code": "invalid_string" }
  ]
}
```

### Field Descriptions

- `success` (boolean) — Whether the operation succeeded
- `message` (string) — Human-readable description
- `data` (object|array|null) — Response payload; `null` on errors
- `error.code` (object) — Machine-readable error code lives at `error.code` (error responses only); see [Error Codes Registry](docs/ERROR_CODES.md)
- `details` (array, optional) — Field-level validation details
- `meta` (object) — Pagination metadata (only for list endpoints)

> **Rate limiting:** `429` responses additionally include a top-level `retryAfter` (seconds) and an RFC-8574 `Retry-After` header.

---

## Pagination

The API supports **two pagination patterns**: offset-based and cursor-based.

### Offset-Based Pagination (Default)

Use `page` and `limit` query parameters for offset pagination:

```bash
curl -X GET "http://localhost:3000/api/shipments?page=2&limit=20" \
  -H "Authorization: Bearer <token>"

# Response includes meta:
# {
#   "data": [...],
#   "meta": {
#     "page": 2,
#     "limit": 20,
#     "total": 150
#   }
# }
```

**Parameters:**
- `page` (integer, default: 1) — Page number (1-indexed)
- `limit` (integer, default: 20, max: 100) — Records per page

### Cursor-Based Pagination (Real-time Data)

For high-frequency data (anomalies, telemetry), use cursor-based pagination:

```bash
curl -X GET "http://localhost:3000/api/anomalies?limit=20" \
  -H "Authorization: Bearer <token>"

# Response:
# {
#   "data": [
#     { "_id": "...", "type": "TEMPERATURE_EXCEEDED", ... },
#     { "_id": "...", "type": "HUMIDITY_LOW", ... }
#   ],
#   "meta": {
#     "nextCursor": "eyJfaWQiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTEifQ",
#     "hasMore": true
#   }
# }
```

**Fetch next page:**

```bash
curl -X GET "http://localhost:3000/api/anomalies?limit=20&cursor=eyJfaWQiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTEifQ" \
  -H "Authorization: Bearer <token>"
```

**When to use cursor-based:**
- Real-time feeds (anomaly streams, telemetry)
- Data that changes frequently
- Mobile/streaming clients

---

## Error Handling

All errors include a structured `code` field for programmatic handling. See the [Error Codes Registry](docs/ERROR_CODES.md) for the complete list.

### Common HTTP Status Codes

| Status | Meaning | Example |
|---|---|---|
| `200 OK` | Request succeeded | GET, PATCH successful |
| `201 Created` | Resource created | POST successful |
| `400 Bad Request` | Malformed request | Missing fields, invalid types |
| `401 Unauthorized` | Missing/invalid token | `ERR_AUTH_INVALID` |
| `403 Forbidden` | Insufficient permissions | `ERR_PERMISSION_DENIED` |
| `404 Not Found` | Resource doesn't exist | `ERR_SHIPMENT_NOT_FOUND` |
| `409 Conflict` | Duplicate unique value | `ERR_DUPLICATE_KEY` (email already registered) |
| `500 Internal Server Error` | Unhandled exception | `ERR_INTERNAL_SERVER_ERROR` |

### Example Error Handling (JavaScript)

```typescript
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3000/api' });

api.interceptors.response.use(
  response => response.data,
  error => {
    const code = error.response?.data?.error?.code;

    if (code === 'ERR_AUTH_INVALID') {
      // Handle expired session
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    } else if (code === 'ERR_PERMISSION_DENIED') {
      // Handle insufficient permissions
      console.error('Access denied:', error.response.data.message);
    } else if (code === 'ERR_VALIDATION_FAILED') {
      // Handle validation errors
      console.error('Invalid input:', error.response.data.message);
    }
    throw error;
  }
);
```

---

## Real-time Features

The backend supports **WebSocket (Socket.IO)** connections for real-time updates on shipments and anomalies.

### Connection

```typescript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your_jwt_token_here'
  }
});

socket.on('connect', () => {
  console.log('Connected to real-time server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from real-time server');
});
```

### Listen for Updates

```typescript
// Listen for shipment status changes
socket.on('shipment:status', (shipment) => {
  console.log('Shipment status updated:', shipment);
});

// Listen for new anomalies
socket.on('anomaly:detected', (anomaly) => {
  console.log('Anomaly detected:', anomaly);
});
```

For detailed WebSocket documentation, see [WebSocket Features](docs/websockets.md).
For the IoT → BullMQ → Stellar → anomaly detection flow, see [Telemetry Ingestion Pipeline](docs/telemetry-pipeline.md).

---

## Available Endpoints

Summary of the main surfaces — **the full, authoritative reference is [docs/swagger.yaml](docs/swagger.yaml)**.

### Health & Status
| Method | Path | Auth | Description |
|--------|------|------|---|
| `GET` | `/api/health` | No | System health check |

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|---|
| `POST` | `/api/auth/signup` | No | Register a new user (assigned `VIEWER`) |
| `POST` | `/api/auth/login` | No | Authenticate and get JWT token |
| `POST` | `/api/auth/refresh` | No | Refresh session token (old jti blocklisted) |
| `POST` | `/api/auth/register/company` | No | Create company + first ADMIN atomically |
| `POST` | `/api/auth/logout` | Yes | Revoke current session (blocklists jti) |
| `GET` / `DELETE` | `/api/auth/sessions[/{jti}]` | Yes | List / revoke sessions |
| `POST` / `DELETE` | `/api/auth/2fa/setup`, `/verify`, `/{...}` | Yes | TOTP 2FA lifecycle + backup codes |
| `GET` / `POST` / `DELETE` | `/api/company/api-keys[/{id}]` | ADMIN+ | Machine-to-machine API keys |

> The legacy `/api/auth/api-keys/*` routes still work but are deprecated aliases of the module above.

### Users & Invitations
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/users/me` | Yes | Any | Current user profile |
| `GET` | `/api/users` | Yes | MANAGER+ | List organization users (cursor or offset) |
| `POST` / `DELETE` | `/api/users[/{id}]` | Yes | ADMIN+ | Create / soft-delete users |
| `POST` | `/api/users/invitations` | Yes | ADMIN+ | Generate invitation link |
| `GET` / `POST` | `/api/users/invitations/verify`, `/accept` | No | — | Verify token / accept invitation |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/company/invitations[...]` | ADMIN+ | Manage persistent invitations (resend/revoke/info) |

### Organizations
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `POST` / `GET` / `GET·PATCH·DELETE {id}` | `/api/organizations[/{id}]` | SUPER_ADMIN (+ADMIN read/update) | Organization CRUD |

### Shipments
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/shipments` | Yes | VIEWER+ | List shipments (offset pagination) |
| `POST` | `/api/shipments` | Yes | MANAGER+ | Create shipment (Stellar-tokenized) |
| `GET·PATCH·DELETE` | `/api/shipments/{id}` | Yes | role varies | Details / update / soft-delete |
| `PATCH` | `/api/shipments/{id}/status` | Yes | MANAGER+ | Status transition (state machine) |
| `POST` | `/api/shipments/{id}/proof` | Yes | MANAGER+ | Upload proof of delivery (multipart) |
| `POST` | `/api/shipments/{id}/documents`, `/{id}/photos` | Yes | MANAGER+ | Attach files (multipart) |
| `GET` | `/api/shipments/{id}/timeline`, `/{id}/eta` | Yes | VIEWER+ | Milestone timeline / ETA |
| `POST` | `/api/shipments/{id}/disputes` | Yes | MANAGER+ | Raise a dispute |
| `GET` | `/api/shipments/export?format=csv` | Yes | ADMIN/MANAGER | CSV export (≤10k rows) |
| CRUD | `/api/shipment-templates[/{id}]` | Yes | VIEWER+ read / MANAGER+ write | Reusable shipment templates |

### Ledger & Telemetry & Anomalies
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/ledger/blocks`, `/blocks/{id}` | Yes | VIEWER+ | Immutable milestone ledger (envelope + meta) |
| `GET` / `POST` | `/api/telemetry`, `/telemetry/bulk` | Yes | VIEWER+ | Time-series records / bulk ingest (hashed + anchored) |
| `GET` / `PUT` | `/api/telemetry/thresholds` | Yes | VIEWER+ / ADMIN+ | Per-organization anomaly thresholds |
| `GET` | `/api/anomalies`, `/anomalies/stats` | Yes | VIEWER+ | Anomalies (cursor-paginated) / aggregates |
| `PATCH` | `/api/anomalies/{id}/resolve` | Yes | MANAGER+ | Resolve anomaly |

### Analytics, Payments & Settlements
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/analytics/performance`, `/summary` | Yes | MANAGER+ | KPIs / summary with sparklines |
| `GET` | `/api/payments`, `/payments/{id}` | Yes | VIEWER+ | Payment records |
| `POST` / `PATCH` | `/api/payments`, `/payments/{id}/status` | Yes | ADMIN+ | Create / update payments |
| `GET` | `/api/settlements`, `/settlements/summary`, `/{id}` | Yes | VIEWER+ | Settlement views |
| `POST` | `/api/settlements/{id}/dispute` | Yes | MANAGER+ | Dispute a settlement |

### Notifications & Activity
| Method | Path | Auth | Description |
|--------|------|------|---|
| `GET` | `/api/notifications`, `/unread-count` | Yes | List notifications / unread badge |
| `PATCH` / `POST` / `DELETE` | `/notifications/{id}/read`, `/read-all`, `/{id}` | Yes | Read-state management |
| `GET` / `PATCH` | `/api/notifications/preferences` | Yes | Channel preferences |
| `POST` | `/api/notifications/phone/send-otp`, `/verify-otp` | Yes | SMS OTP verification |
| `GET` | `/api/activity` · `/api/audit-logs` | Yes | Activity feed (all roles) / audit trail (ADMIN+) |

### Real-time & Webhooks
| Method | Path | Auth | Description |
|--------|------|------|---|
| `GET` | `/api/events` (`?token=`) | SSE auth | Server-Sent Events stream |
| `GET` | `/api/events/poll` | Yes | Fallback polling stream |
| `POST` | `/api/webhooks/iot` | API Key | Receive IoT telemetry |
| `POST` | `/api/webhooks/stellar` | HMAC Signature | Stellar settlement callbacks |

---

## Environment Variables

Configuration is validated at boot with Zod (`src/env.ts`) — the process **exits immediately** if a required variable is missing or malformed.

**Core variables:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | ✅ Yes | — | MongoDB connection string (`mongodb://…`) |
| `JWT_SECRET` | ✅ Yes | — | JWT signing secret (**min 32 characters**) |
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |
| `REDIS_URL` | No | `redis://127.0.0.1:6379` | Redis (BullMQ queues, SSE, caches) |
| `STELLAR_NETWORK` | No | `testnet` | `testnet` \| `public` |
| `STELLAR_SECRET_KEY` | Optional | — | Horizon signing key (required for anchoring jobs) |
| `STELLAR_WEBHOOK_SECRET` | Optional | — | HMAC secret for `/api/webhooks/stellar` (min 16 chars) |
| `FRONTEND_URL` | No | `http://localhost:3000` | Invite / password-reset link base |
| `ALLOWED_ORIGINS` | No | *(empty)* | Comma-separated CORS allowlist |
| `TOTP_ENCRYPTION_KEY` | Optional* | — | 64-hex AES-256 key for 2FA secrets (*required in production*) |
| `STORAGE_PROVIDER` | No | `mock` | `mock` \| `s3` \| `r2` \| `cloudinary` |

The full matrix — SMTP, SendGrid, Twilio, S3/Cloudinary keys, Soroban placeholders, Sentry — lives in [`docs/environment-variables.md`](docs/environment-variables.md) and [`.env.example`](.env.example). There are **no** `JWT_EXPIRY`, `STELLAR_HORIZON_URL`, `STELLAR_NETWORK_PASSPHRASE`, or `API_KEY_PREFIX` variables; token TTL is fixed in code and the Horizon URL/network passphrase derive from `STELLAR_NETWORK`.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to JavaScript in `dist/` |
| `npm run start` | Run production build |
| `npm run typecheck` | Run TypeScript type checker |
| `npm run check:deps` | Check runtime imports against `package.json` dependencies |
| `npm run lint` | Run ESLint over `src/` |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm test` | Run test suite (Jest with ESM VM modules) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run migrate:up` | Apply pending database migrations (migrate-mongo) |
| `npm run migrate:down` | Rollback last migration |
| `npm run seed` | Seed the database with development data |
| `npm run worker:stellar` | Standalone telemetry → Stellar anchoring worker |
| `npm run worker:stellar-indexer` | Standalone Stellar confirmation indexer worker |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on branching, commits, pull requests, and our build/test requirements.

## Security

If you discover a security vulnerability, email [navinxmr@gmail.com](mailto:navinxmr@gmail.com) — do **not** open a public issue.

## Community

- [Telegram Group Chat](https://t.me/+3svwFsQME6k1YjI0)

---

**Built on the Stellar ecosystem.**
