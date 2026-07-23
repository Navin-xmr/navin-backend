# Navin Backend

**Navin** is a blockchain-powered logistics platform that improves supply chain visibility for enterprises through tokenized shipments, immutable milestone tracking, and automated settlements.
By creating a zero-trust interface between logistics providers and their clients, Navin aims to ensure both parties access identical real-time data — removing information asymmetry and enabling seamless, dispute-free operations.

The backend service powers the off-chain layer of the platform, handling API logic, data aggregation, and integration with Soroban smart contracts.

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

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env

# 4. Update .env with your MongoDB connection string
# Edit .env and set: MONGO_URI=mongodb://...

# 5. Start the development server (with hot reload)
npm run dev

# Expected output:
# Server running on http://localhost:3000
# Connected to MongoDB
```

The API is now available at `http://localhost:3000/api`

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
#   "message": "User registered successfully",
#   "data": {
#     "user": {
#       "_id": "507f1f77bcf86cd799439011",
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
# { "success": false, "message": "Missing or invalid token", "code": "ERR_AUTH_INVALID" }
```

### 4. Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <your_token>"

# Response: { "success": true, "message": "Logged out successfully", "data": null }
```

### JWT Expiration

Tokens expire after **24 hours** by default. When expired, the API returns:

```json
{
  "success": false,
  "code": "ERR_AUTH_INVALID",
  "message": "Token has expired"
}
```

**Action**: Redirect user to login page and request a new token.

### Role-Based Access Control (RBAC)

User roles determine which endpoints they can access:

| Role | Permission Level | Typical Use Case |
|------|---|---|
| `SUPER_ADMIN` | Full system access | Internal DevOps, system administration |
| `ADMIN` | Organization administration | Company managers, billing access |
| `MANAGER` | Shipment & analytics management | Logistics coordinators |
| `VIEWER` | Read-only access | Drivers, customers (view shipments only) |
| `CUSTOMER` | Minimal read access | External parties (tracking only) |

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
  "code": "ERR_VALIDATION_FAILED"
}
```

### Field Descriptions

- `success` (boolean) — Whether the operation succeeded
- `message` (string) — Human-readable description
- `data` (object|array|null) — Response payload; `null` on errors
- `code` (string) — Error code (only in error responses); see [Error Codes Registry](docs/ERROR_CODES.md)
- `meta` (object) — Pagination metadata (only for list endpoints)

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
    const code = error.response?.data?.code;
    
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
socket.on('shipment:updated', (shipment) => {
  console.log('Shipment updated:', shipment);
});

// Listen for new anomalies
socket.on('anomaly:detected', (anomaly) => {
  console.log('Anomaly detected:', anomaly);
});
```

For detailed WebSocket documentation, see [WebSocket Features](docs/websockets.md).

---

## Available Endpoints

### Health & Status
| Method | Path | Auth | Description |
|--------|------|------|---|
| `GET` | `/api/health` | No | System health check (no auth required) |

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|---|
| `POST` | `/api/auth/signup` | No | Register a new user |
| `POST` | `/api/auth/login` | No | Authenticate and get JWT token |
| `POST` | `/api/auth/logout` | Yes | Revoke current JWT |
| `POST` | `/api/auth/api-keys` | Yes | Create machine-to-machine API key |
| `GET` | `/api/auth/api-keys/{organizationId}` | Yes | List API keys for organization |
| `DELETE` | `/api/auth/api-keys/{apiKeyId}` | Yes | Revoke an API key |

### Users & Team
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/users` | Yes | ADMIN+ | List organization users |
| `POST` | `/api/users` | Yes | ADMIN+ | Create a new user |
| `DELETE` | `/api/users/{id}` | Yes | ADMIN+ | Delete a user (soft delete) |
| `POST` | `/api/users/invitations` | Yes | ADMIN+ | Generate invitation link |
| `GET` | `/api/users/invitations/verify` | No | — | Verify invitation token |
| `POST` | `/api/users/invitations/accept` | No | — | Accept invitation & create account |

### Shipments
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/shipments` | Yes | VIEWER+ | List shipments (paginated) |
| `POST` | `/api/shipments` | Yes | MANAGER+ | Create a new shipment |
| `GET` | `/api/shipments/{id}` | Yes | VIEWER+ | Get shipment details |
| `PATCH` | `/api/shipments/{id}` | Yes | MANAGER+ | Update shipment metadata |
| `PATCH` | `/api/shipments/{id}/status` | Yes | MANAGER+ | Update shipment status |
| `POST` | `/api/shipments/{id}/proof` | Yes | MANAGER+ | Upload proof of delivery |
| `DELETE` | `/api/shipments/{id}` | Yes | ADMIN+ | Delete shipment (soft delete) |

### Telemetry & Monitoring
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/telemetry` | Yes | VIEWER+ | Get telemetry records (time-series) |
| `GET` | `/api/anomalies` | Yes | VIEWER+ | List anomalies (cursor-paginated) |
| `PATCH` | `/api/anomalies/{id}/resolve` | Yes | MANAGER+ | Mark anomaly as resolved |
| `GET` | `/api/analytics/performance` | Yes | VIEWER+ | Get shipment performance analytics |

### Payments & Settlements
| Method | Path | Auth | Role | Description |
|--------|------|------|------|---|
| `GET` | `/api/payments` | Yes | VIEWER+ | List payment records (Stellar settlements) |

### Webhooks
| Method | Path | Auth | Description |
|--------|------|------|---|
| `POST` | `/api/webhooks/iot` | API Key | Receive IoT telemetry data |
| `POST` | `/api/webhooks/stellar` | Signature | Receive Stellar settlement callbacks |

---

## Environment Variables

All required and optional environment variables for development and production:

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | ✅ Yes | — | MongoDB connection string (e.g., `mongodb://localhost:27017/navin`) |
| `PORT` | ❌ No | `3000` | Port on which the API server listens |
| `NODE_ENV` | ❌ No | `development` | Environment mode (`development`, `production`, `test`) |
| `JWT_SECRET` | ❌ No | Generated | Secret key for signing JWTs (must be strong in production) |
| `JWT_EXPIRY` | ❌ No | `24h` | JWT expiration time (e.g., `24h`, `7d`) |
| `REDIS_URL` | ❌ No | `redis://localhost:6379` | Redis connection string (for sessions, rate limiting) |
| `STELLAR_HORIZON_URL` | ❌ No | `https://horizon-testnet.stellar.org` | Stellar Horizon API endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | ❌ No | `Test SDF Network ; September 2015` | Stellar network identifier |
| `LOG_LEVEL` | ❌ No | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `CORS_ORIGINS` | ❌ No | `http://localhost:3000,http://localhost:5173` | Comma-separated list of allowed origins |
| `API_KEY_PREFIX` | ❌ No | `sk_` | Prefix for generated API keys |

### Example .env File

```bash
# Database
MONGO_URI=mongodb://user:password@mongodb.example.com:27017/navin

# Server
PORT=3000
NODE_ENV=production

# Authentication
JWT_SECRET=your-super-secret-key-change-this-in-production
JWT_EXPIRY=24h

# Redis (for sessions & caching)
REDIS_URL=redis://:password@redis.example.com:6379

# Stellar Blockchain
STELLAR_HORIZON_URL=https://horizon.stellar.org
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

# Logging
LOG_LEVEL=info

# CORS
CORS_ORIGINS=https://app.navin.io,https://staging.navin.io

# API Keys
API_KEY_PREFIX=sk_
```

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to JavaScript in `dist/` |
| `npm run start` | Run production build |
| `npm run typecheck` | Run TypeScript type checker |
| `npm run lint` | Run ESLint and Prettier checks |
| `npm run lint:fix` | Fix linting and formatting issues |
| `npm test` | Run test suite (Jest) |
| `npm test -- --watch` | Run tests in watch mode |
| `npm run migrations:up` | Run pending database migrations |
| `npm run migrations:down` | Rollback last migration |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on branching, commits, pull requests, and our build/test requirements.

## Security

If you discover a security vulnerability, email [navinxmr@gmail.com](mailto:navinxmr@gmail.com) — do **not** open a public issue.

## Community

- [Telegram Group Chat](https://t.me/+3svwFsQME6k1YjI0)

---

**Built with leveraging the Stellar ecosystem technology**
