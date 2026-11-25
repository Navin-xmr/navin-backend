# Frontend trustless verification flow

The API can be wrong or compromised. A client should never display a "verified"
badge from a backend flag alone. Instead it fetches the verification bundle from
`GET /api/ledger/blocks/{id}/verification` and independently checks both the
off-chain digest and the on-chain transaction.

The bundle is `{ canonicalPayload, dataHash, txHash, ledger, network }`:

| Field              | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `canonicalPayload` | Exact object hashed into `dataHash`. `null` means the block is **unverifiable**. |
| `dataHash`         | Lowercase hex SHA-256 digest of the canonical payload (64 chars).              |
| `txHash`           | Stellar transaction hash containing the digest.                                |
| `ledger`           | Ledger sequence the transaction landed in.                                     |
| `network`          | `testnet` or `public` — selects the Horizon/RPC endpoint.                      |

## The 4 steps

1. **Fetch the bundle** from the authenticated verification endpoint. Choose the
   Horizon and Soroban RPC hosts from `network` (never from a frontend constant).

2. **Recompute SHA-256** over the canonical JSON bytes of `canonicalPayload` and
   compare with `dataHash`. Canonical bytes are `JSON.stringify` of the object
   with object keys sorted recursively, `undefined` fields omitted, and all
   whitespace stripped — the same normalization as
   `src/shared/utils/crypto.ts` (`generateDataHash`).

3. **Query Stellar directly** for `txHash` via Horizon (`memo_hash` /
   `manageData` value) or Soroban RPC (`getTransaction` + `getEvents`), and
   confirm the on-chain digest equals `dataHash` at the reported `ledger`.

4. **Display the verified badge** only when both comparisons pass. If the
   payload is missing, the digests differ, or the transaction cannot be found,
   show *unverifiable* / *pending* — never *verified*.

## Step 1–2: fetch and recompute (TypeScript)

```ts
type Bundle = {
  canonicalPayload: Record<string, unknown> | null;
  dataHash: string | null;
  txHash: string | null;
  ledger: number;
  network: 'testnet' | 'public';
};

const HORIZON = {
  testnet: 'https://horizon-testnet.stellar.org',
  public: 'https://horizon.stellar.org',
} as const;

const RPC = {
  testnet: 'https://soroban-testnet.stellar.org',
  public: 'https://mainnet.sorobanrpc.com',
} as const;

function canonicalBytes(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalBytes(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function verifyOffchain(bundle: Bundle): Promise<boolean> {
  if (!bundle.canonicalPayload || !bundle.dataHash) return false;
  // Backend also strips all whitespace, including inside string values.
  const bytes = new TextEncoder().encode(canonicalBytes(bundle.canonicalPayload).replace(/\s+/g, ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === bundle.dataHash.toLowerCase();
}

const response = await fetch(`/api/ledger/blocks/${blockId}/verification`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { data: bundle } = (await response.json()) as { data: Bundle };
const offchainOk = await verifyOffchain(bundle);
```

## Step 3: query Stellar directly

Horizon (Horizon-anchored blocks — `manageData` / `Memo.hash`):

```bash
curl -s "https://horizon-testnet.stellar.org/transactions/${TX_HASH}" \
  | jq '{ledger, memo: .memo_hash, operations: [.operations[] | select(.type == "manage_data") | {key: .key, value: .value}]}'
```

Soroban RPC (event-anchored blocks):

```bash
curl -s "${RPC_URL}" -H 'Content-Type: application/json' -d "{
  \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"getTransaction\",
  \"params\": { \"hash\": \"${TX_HASH}\" }
}"
curl -s "${RPC_URL}" -H 'Content-Type: application/json' -d "{
  \"jsonrpc\": \"2.0\", \"id\": 2, \"method\": \"getEvents\",
  \"params\": { \"transactionHash\": \"${TX_HASH}\" }
}"
```

Replace the host with `HORIZON[bundle.network]` / `RPC[bundle.network]` above.
Check that the returned ledger matches `bundle.ledger` and that the digest in
the memo / `manageData` value / event data equals `bundle.dataHash` byte for
byte (hex digests are lowercase; `Memo.hash` is base64-encoded raw bytes).

## Step 4: render the badge

```ts
const onchainOk = await verifyOnHorizonOrRpc(bundle); // your Step 3 implementation
const verified = offchainOk && onchainOk;
// verified ? <Badge kind="success">Verified on Stellar</Badge>
//          : <Badge kind="warning">Not verified / pending</Badge>
```

Never fall back to `block.verified` from the API for this badge: it is a
convenience field, not a trust root. See [chain-interface.md](chain-interface.md)
for the contract ABI and [blockchain.md](blockchain.md) for the backend
integration background.
