# Frontend chain verification (v2)

Verify a shipment without trusting the backend's indexer: fetch the API's canonical payload, recompute its SHA-256, then compare it with the matching Soroban event. The v2 event names are `shipment_created`, `status_updated`, and `milestone_recorded`. The v1 `anchor` event and legacy `dataHash` bundle are not part of this flow.

For event tuple details and current contract ABI, see [navin-contracts `FRONTEND_VERIFICATION.md`](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/FRONTEND_VERIFICATION.md). The backend verification endpoint is `GET /api/ledger/blocks/{id}/verification` and requires a bearer token. This repo's adapter parser is still v1; do not treat a v1 backend record as a v2 contract event.

## Verification steps

1. Fetch the verification bundle. Keep `canonicalPayload`, `dataHash`, `txHash`, and `network` exactly as returned.
2. Select the Soroban RPC endpoint from the expected network. Fetch `getTransaction(txHash)` and require `status === "SUCCESS"`.
3. Query `getEvents` for the network-pinned contract and expected event name. Require its contract ID, transaction hash, ledger, and event type to match the verification bundle and the action being rendered.
4. Decode the event with the contract ABI. Require the event `version` to equal `canonicalPayload.schema_version`; recompute `idempotency_key` from the event's shipment ID, event type, and counter; require an exact match.
5. Recompute SHA-256 from the canonical payload and compare it with both the API's `dataHash` and the event's `data_hash`. Render a verified badge only if every check succeeds.

## Runnable fetch, RPC, and Web Crypto example

Install `@stellar/stellar-sdk` in the frontend and pin the contract ID for each deployment. `scValToNative` decodes the `shipment_created` tuple defined by the v2 contract ABI.

```js
import { rpc, scValToNative } from '@stellar/stellar-sdk';

const RPC_URL = {
  testnet: 'https://soroban-testnet.stellar.org',
  public: 'https://mainnet.sorobanrpc.com',
};
const EXPECTED_CONTRACT_ID = {
  testnet: 'C_REPLACE_WITH_PINNED_TESTNET_CONTRACT',
  public: 'C_REPLACE_WITH_PINNED_PUBLIC_CONTRACT',
};

async function fetchVerification(apiBase, blockId, token) {
  const response = await fetch(
    `${apiBase}/api/ledger/blocks/${encodeURIComponent(blockId)}/verification`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) throw new Error(`Verification API returned ${response.status}`);
  const envelope = await response.json();
  if (!envelope.success || !envelope.data) throw new Error('Missing verification data');
  return envelope.data;
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashCanonicalPayload(payload) {
  // Match generateDataHash: sorted keys, compact JSON, then UTF-8 SHA-256.
  const compact = JSON.stringify(canonicalize(payload)).replace(/\s+/g, '');
  return sha256Hex(new TextEncoder().encode(compact));
}

function u32be(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64be(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function symbolXdr(value) {
  const text = new TextEncoder().encode(value);
  const bytes = new Uint8Array(4 + Math.ceil(text.length / 4) * 4);
  bytes.set(u32be(text.length));
  bytes.set(text, 4);
  return bytes;
}

function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function computeIdempotencyKey(shipmentId, eventName, eventCounter) {
  return sha256Hex(concatBytes(u64be(shipmentId), symbolXdr(eventName), u32be(eventCounter)));
}

function bytesToHex(value) {
  if (typeof value === 'string') return value.replace(/^0x/, '').toLowerCase();
  if (value instanceof Uint8Array) {
    return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new TypeError('Expected decoded Soroban bytes');
}

async function verifyShipmentCreated(apiBase, blockId, token, expectedNetwork) {
  const bundle = await fetchVerification(apiBase, blockId, token);
  if (bundle.network !== expectedNetwork || !RPC_URL[bundle.network]) return false;
  const contractId = EXPECTED_CONTRACT_ID[bundle.network];
  if (!contractId || contractId.startsWith('C_REPLACE_')) return false;

  const server = new rpc.Server(RPC_URL[bundle.network]);
  const transaction = await server.getTransaction(bundle.txHash);
  if (transaction.status !== 'SUCCESS' || transaction.ledger !== bundle.ledger) return false;
  const page = await server.getEvents({
    startLedger: transaction.ledger,
    limit: 100,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
        topics: [['shipment_created']],
      },
    ],
  });
  const event = page.events.find(
    candidate => candidate.txHash === bundle.txHash && candidate.contractId === contractId
  );
  if (!event || scValToNative(event.topic[0]) !== 'shipment_created') return false;

  // v2 shipment_created data:
  // [shipment_id, sender, receiver, data_hash, version, counter, idempotency_key]
  const data = scValToNative(event.value);
  if (!Array.isArray(data) || data.length !== 7) return false;
  const [shipmentId, , , dataHash, version, counter, idempotencyKey] = data;
  if (String(shipmentId) !== String(bundle.canonicalPayload.shipment_id)) return false;
  if (Number(version) !== bundle.canonicalPayload.schema_version) return false;

  const computedKey = await computeIdempotencyKey(shipmentId, 'shipment_created', Number(counter));
  if (computedKey !== bytesToHex(idempotencyKey)) return false;
  const computedHash = await hashCanonicalPayload(bundle.canonicalPayload);
  return computedHash === bundle.dataHash && computedHash === bytesToHex(dataHash);
}

const verified = await verifyShipmentCreated(API_BASE, BLOCK_ID, ACCESS_TOKEN, 'testnet');
renderVerificationBadge(verified ? 'Verified on Stellar' : 'Could not verify');

// Tampering with any canonical field must fail the digest comparison:
const fixture = await (await fetch('/docs/fixtures/chain-frontend-verification-v2.json')).json();
const tampered = { ...fixture.canonical_payload, origin: 'SanFrancisco' };
console.assert((await hashCanonicalPayload(tampered)) !== fixture.data_hash);
```

`API_BASE`, `BLOCK_ID`, `ACCESS_TOKEN`, and `renderVerificationBadge` are application inputs/helpers. Replace both contract ID placeholders with independently pinned deployment IDs. The RPC URL is selected from the expected network; a bundle/network mismatch fails before any event can be accepted. A network without a pinned contract ID also fails closed.

## Idempotency and schema participation

The idempotency key is `SHA-256(shipment_id_u64_be || event_type_symbol_xdr || event_counter_u32_be)`. `schema_version` and `idempotency_key` are both part of the canonical JSON payload bytes hashed into `data_hash`. For the v2 `shipment_created` data tuple, `version` is the schema version and the key is at the final tuple position. Never omit either field or silently replace it with a default.

The tuple indices in the runnable sample are specific to `shipment_created`. `status_updated` and `milestone_recorded` also carry `data_hash`, schema version, counter, and idempotency key; decode their event-specific tuple from the contracts ABI before applying the same version/key/hash comparisons. Do not reuse the `shipment_created` tuple offsets for the other event variants.

## Fixture and tampering example

[`docs/fixtures/chain-frontend-verification-v2.json`](./fixtures/chain-frontend-verification-v2.json) is a deterministic end-to-end vector for the v2 payload and key encoding:

- Expected idempotency key: `1579e986caaf4fd6239e8dc59dc93eafb0ef1f4b8d22458872ba6ab75e4c5a7d`
- Expected payload SHA-256 (`data_hash`): `2aef69c53ddbad2febbf2a4f204a0dfdee4d5d9850d8569cfb2a8cd820f67ed9`

If an integrator changes `schema_version` from `2` to `1`, omits `idempotency_key`, or changes any payload value, the recomputed digest differs and the event must be shown as unverified. Likewise, a correct hash from another network or contract is not proof for this shipment.

## Network and contract mismatch handling

- Select `https://soroban-testnet.stellar.org` for `testnet`, or the deployment's configured public-network RPC for `public`.
- Compare the RPC response network with the bundle network and the configured network. Refuse verification if they differ.
- Compare `contractId` with the contract address pinned for that network. Never accept an event solely because its transaction hash matches.
- A missing transaction, a non-`SUCCESS` result, no matching event, an unsupported schema version, or a hash/key mismatch is a failed verification—not a loading success or an invitation to trust the API badge.
