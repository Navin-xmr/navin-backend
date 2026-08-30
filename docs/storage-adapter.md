# Storage adapter contract

Navin Backend uploads delivery proofs, shipment documents/photos, and dispute
evidence through a **storage adapter** so the shipments module does not couple
directly to a cloud SDK.

Related work: real object-storage implementation — [#375](https://github.com/Navin-xmr/navin-backend/issues/375).

## Current state (mock)

`src/services/mockStorageService.ts` exports `mockUploadToStorage`, which:

- Accepts an Express/Multer `file` (in-memory buffer)
- Sleeps briefly to simulate network I/O
- Returns a fake URL (`https://mock-storage.com/proof…`)

Call sites today:

| Flow | Service entry |
|------|----------------|
| Delivery proof | `uploadShipmentProofService` |
| Dispute evidence | `createDisputeService` |
| Document upload | `uploadShipmentDocumentService` |
| Photo upload | `uploadShipmentPhotoService` |

All of these import the mock directly. There is **no** runtime provider switch yet.

## Target interface

The real adapter (issue #375) should implement:

```ts
export interface StorageAdapter {
  /**
   * Persist file bytes under a stable object key and return a public or signed URL.
   */
  uploadFile(
    buffer: Buffer,
    mimeType: string,
    key: string
  ): Promise<{ url: string; key: string }>;
}
```

Optional follow-ons (not required for the first cut):

- `deleteObject(key: string): Promise<void>`
- `getSignedUrl(key: string, expiresInSeconds: number): Promise<string>`

## Provider selection

When wiring the real adapter, select the implementation from env:

| Variable | Purpose |
|----------|---------|
| `STORAGE_PROVIDER` | Provider id: `mock` (default), `s3`, or `cloudinary` |
| `STORAGE_BUCKET` | Logical bucket / container name (alias for provider bucket) |
| `S3_BUCKET` | AWS/S3-compatible bucket (already in `.env.example`) |
| `S3_ENDPOINT` | Custom S3 API endpoint (MinIO, R2, etc.) |
| `S3_ACCESS_KEY` | Access key id |
| `S3_SECRET_KEY` | Secret access key |
| `S3_REGION` | Region string |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (if provider is `cloudinary`) |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

Existing config already maps the S3 family under `config.s3` in `src/config/index.ts`.
`STORAGE_PROVIDER` / `STORAGE_BUCKET` / Cloudinary vars are the **planned** surface for #375;
they are not validated in `src/env.ts` until the real adapter lands.

## Migration path (mock → real)

1. **Introduce** `StorageAdapter` (shared types) and a `createStorageAdapter()` factory
   that returns the mock when `STORAGE_PROVIDER` is unset or `mock`.
2. **Implement** `S3StorageAdapter.uploadFile` using `config.s3`, building object keys
   such as `shipments/{shipmentId}/proofs/{uuid}.{ext}`.
3. **Swap** call sites from `mockUploadToStorage(file)` to:

   ```ts
   const { url } = await storage.uploadFile(file.buffer, file.mimetype, key);
   ```

4. **Keep** the mock adapter for local tests and CI without cloud credentials.
5. **Document** provider-specific IAM / CORS requirements in this file when #375 merges.

## Design notes

- Prefer returning `{ url, key }` so soft-delete and re-signing can use the key later;
  callers that only need a string URL can destructure `url`.
- Keys should be deterministic enough for ops (prefix by shipment id) but unique
  (UUID or content hash suffix) to avoid overwrites.
- Do not embed credentials in URLs stored on shipment documents; prefer public
  CDN URLs or short-lived signed URLs depending on the provider.
