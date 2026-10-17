# Client-Side Chain Verification Guide

Navin uses a **Hash-and-Emit** pattern for ledger blocks: off-chain milestone and settlement payloads are canonicalized via deterministic JSON serialization (`canonicalJson` in `src/shared/crypto/canonicalHash.ts`), hashed with SHA-256 (`dataHash`), and anchored on Stellar (Horizon `Memo.hash` / `manageData` in simulated mode, or Soroban contract event emission in `soroban` mode).

## Client-Side Verification Flow

Frontend applications can independently verify any `LedgerBlock` in three steps:

1. **Fetch the Verification Bundle**: Request `GET /api/ledger/blocks/:id/verification` to retrieve `{ blockId, shipmentId, milestoneEvent, txHash, dataHash, canonicalPayload, anchoredAt, network }`.
2. **Recompute `sha256(canonicalPayload)` in the Browser**: Use the browser's Web Crypto API (`crypto.subtle.digest('SHA-256', ...)`) on the UTF-8 bytes of `canonicalPayload` and compare with `dataHash`.
3. **Query Horizon / Soroban RPC for `txHash` on `network`**: Fetch the transaction from Stellar Horizon or Soroban RPC on the indicated `network` (`testnet` or `public`) and compare the on-chain event / memo hash against `dataHash`.

### TypeScript / Web Crypto Implementation

```typescript
export interface LedgerBlockVerificationBundle {
  blockId: string;
  shipmentId: string;
  milestoneEvent: string;
  txHash: string;
  dataHash: string | null;
  canonicalPayload: string | null;
  anchoredAt: string;
  network?: 'testnet' | 'public';
}

export async function sha256HexBrowser(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  return Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

export async function verifyLedgerBlockClientSide(
  apiBaseUrl: string,
  blockId: string,
  authToken: string
) {
  // 1. Fetch GET /api/ledger/blocks/:id/verification
  const res = await fetch(
    `${apiBaseUrl}/api/ledger/blocks/${encodeURIComponent(blockId)}/verification`,
    {
      headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data: bundle } = (await res.json()) as { data: LedgerBlockVerificationBundle };

  if (!bundle.canonicalPayload || !bundle.dataHash) {
    return { verified: false, reason: 'Missing canonicalPayload or dataHash' };
  }

  // 2. Recompute sha256(canonicalPayload) in the browser and compare with dataHash
  const recomputedHash = await sha256HexBrowser(bundle.canonicalPayload);
  const expectedHash = bundle.dataHash.toLowerCase();
  if (recomputedHash !== expectedHash) {
    return { verified: false, reason: 'Off-chain payload hash mismatch', recomputedHash };
  }

  // 3. Query Horizon/Soroban RPC for txHash on network and compare on-chain hash against dataHash
  const horizonBaseUrl =
    bundle.network === 'public'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';

  const txRes = await fetch(`${horizonBaseUrl}/transactions/${encodeURIComponent(bundle.txHash)}`);
  if (!txRes.ok) {
    return { verified: false, reason: `On-chain tx lookup failed: HTTP ${txRes.status}` };
  }
  const txJson = (await txRes.json()) as {
    successful?: boolean;
    memo_type?: string;
    memo?: string;
  };

  const onChainHash =
    txJson.memo_type === 'hash' && typeof txJson.memo === 'string'
      ? base64ToHex(txJson.memo).toLowerCase()
      : null;

  return {
    verified: Boolean(txJson.successful) && onChainHash === expectedHash,
    recomputedHash,
    onChainHash,
  };
}
```
