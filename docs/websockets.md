# Socket.IO Real-Time Events

## Connection

- Endpoint: `ws(s)://<host>/socket.io/`
- Transport: WebSocket (Socket.IO v4)
- Auth handshake: client must send a JWT in the Socket.IO `auth` payload.

Example client connection:

```ts
import { io } from 'socket.io-client';

const socket = io('https://api.navin.local', {
  transports: ['websocket'],
  auth: {
    token: 'Bearer eyJhbGciOiJI...'
  },
});
```

- The server uses `src/infra/socket/io.ts` and `src/shared/middleware/socketAuth.js`.
- Valid JWTs are required to establish a connection and are attached to `socket.user`.
- Once connected, the server maintains an active socket registry and automatically cleans up rooms and state on `disconnecting` / `disconnect`.

## Authentication and handshake

1. Client connects to the Socket.IO endpoint.
2. The client includes an `auth.token` field containing the bearer JWT.
3. `socketAuth` validates the token, populates `socket.user`, and allows the connection.
4. If authentication fails, the socket connection is rejected.

## Client subscription pattern

The client can subscribe to shipment-specific updates by joining a shipment room.

- Emit `join_shipment` with a shipment ID to start receiving events for that shipment.
- Emit `leave_shipment` with a shipment ID to stop receiving events for that shipment.

Example:

```ts
socket.emit('join_shipment', shipmentId);
socket.on('room_joined', payload => {
  console.log('Joined shipment room', payload);
});

socket.emit('leave_shipment', shipmentId);
socket.on('room_left', payload => {
  console.log('Left shipment room', payload);
});
```

## Events emitted by the server

### `telemetry_update`

Emitted when new telemetry arrives for a shipment.

Payload schema:

```ts
interface TelemetryUpdatePayload {
  telemetryId: string;
  shipmentId: string;
  sensorId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: string; // ISO 8601 UTC
  dataHash: string;
  anchorStatus: 'PENDING_ANCHOR' | 'ANCHORED' | 'ANCHOR_FAILED';
  stellarTxHash?: string;
}
```

### `anomaly_detected`

Emitted when the backend detects an anomaly in shipment telemetry.

Payload schema:

```ts
interface AnomalyAlertPayload {
  anomalyId: string;
  shipmentId: string;
  type:
    | 'TEMPERATURE_EXCEEDED'
    | 'TEMPERATURE_BELOW_MIN'
    | 'HUMIDITY_EXCEEDED'
    | 'HUMIDITY_BELOW_MIN'
    | 'BATTERY_LOW';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  timestamp: string; // ISO 8601 UTC
  resolved: boolean;
}
```

### `status_update`

Emitted when a shipment status changes.

Payload schema:

```ts
interface StatusUpdatePayload {
  shipmentId: string;
  status: 'CREATED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  milestones?: Array<{
    name: string;
    timestamp: string | Date;
    description?: string | null;
    userId?: string | null;
    walletAddress?: string | null;
  }>;
  updatedAt?: string | Date;
}
```

### `room_joined`

Emitted after the client successfully joins a shipment room.

Payload example:

```json
{
  "shipmentId": "<shipmentId>",
  "room": "shipment_<shipmentId>"
}
```

### `room_left`

Emitted after the client leaves a shipment room.

Payload example:

```json
{
  "shipmentId": "<shipmentId>",
  "room": "shipment_<shipmentId>"
}
```

### `error`

Socket.IO may also emit socket-level errors for authorization or room membership failures.

Payload example:

```json
{
  "code": "UNAUTHORIZED",
  "message": "Not allowed to view this shipment"
}
```

## Disconnect and cleanup behavior

- The server listens on `disconnecting` and logs room state for cleanup.
- It also removes the socket from the active user registry on `disconnect`.
- Clients should call `socket.disconnect()` when leaving the app or swapping contexts.

## Notes

- The Socket.IO flow is implemented in `src/infra/socket/io.ts`.
- Room management helper logic is in `src/infra/socket/shipmentRooms.ts`.
- Payload schemas are defined in `src/shared/types/socketEvents.ts`.
