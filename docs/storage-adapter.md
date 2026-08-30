# Storage adapter contract

Navin Backend uploads delivery proofs, shipment documents/photos, and dispute evidence through a **storage adapter** (`src/services/storage/index.ts`) so the shipments and payments modules do not couple directly to a single cloud SDK.

Related work: real object-storage implementation — [#375](https://github.com/Navin-xmr/navin-backend/issues/375).

---

## Current state (Factory & Providers)

A runtime factory (`getStorageAdapter()` in `src/services/storage/index.ts:29–63`) initializes a singleton `StorageAdapter` implementation based on the `STORAGE_PROVIDER` environment variable.

Supported providers:

| Provider ID | Implementation Class | Target Environment |
|-------------|----------------------|--------------------|
| `mock` | `MockStorageAdapter` (`src/services/storage/mockStorage.ts`) | Local development & testing (default) |
| `s3` | `S3StorageAdapter` (`src/services/storage/s3Storage.ts`) | AWS S3 object storage |
| `r2` | `S3StorageAdapter` (`src/services/storage/s3Storage.ts`) | Cloudflare R2 (S3-compatible endpoint) |
| `cloudinary` | `CloudinaryStorageAdapter` (`src/services/storage/cloudinaryStorage.ts`) | Cloudinary CDN (image optimization) |

### Mock Storage URL Scheme

The `MockStorageAdapter` generates synthetic public URLs using the standard scheme:

```
https://mock-storage.local/{key}?mock=1&ts={timestamp}
```

(Note: Legacy shim `src/services/mockStorageService.ts` used `https://mock-storage.com/...` and is deprecated; see below).

---

## StorageAdapter Contract Interface

The storage adapter abstraction is declared in `src/services/storage/types.ts:8–31`:

```ts
export interface StorageAdapter {
  /**
   * Persist file bytes under a stable object key and return public/signed URL.
   */
  uploadFile(buffer: Buffer, mimeType: string, key: string): Promise<StorageUploadResult>;

  /**
   * Optional: delete object from storage.
   */
  deleteObject?(key: string): Promise<void>;

  /**
   * Optional: generate signed URL valid for limited time.
   */
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;
}

export interface StorageUploadResult {
  url: string;
  key: string;
}
```

---

## Environment Variable Matrix

All storage configuration variables are validated at runtime in `src/env.ts`:

| Variable | Type / Values | Required For | Description |
|----------|---------------|--------------|-------------|
| `STORAGE_PROVIDER` | `z.enum(['mock', 's3', 'r2', 'cloudinary'])` | All (default `mock`) | Provider selector |
| `S3_BUCKET` | `z.string().min(1)` | `s3`, `r2` | Target bucket name |
| `S3_ENDPOINT` | `z.string().url()` | `r2` (or MinIO/custom S3) | S3 API endpoint URL |
| `S3_ACCESS_KEY` | `z.string().min(1)` | `s3`, `r2` | Access key ID |
| `S3_SECRET_KEY` | `z.string().min(1)` | `s3`, `r2` | Secret access key |
| `S3_REGION` | `z.string().min(1)` | `s3` (optional for `r2`) | S3 region (defaults to `us-east-1` if omitted) |
| `CLOUDINARY_CLOUD_NAME` | `z.string().min(1)` | `cloudinary` | Cloudinary account cloud name |
| `CLOUDINARY_API_KEY` | `z.string().min(1)` | `cloudinary` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | `z.string().min(1)` | `cloudinary` | Cloudinary API secret |

---

## Deprecation Notice: Legacy `mockStorageService.ts`

> [!WARNING]
> `src/services/mockStorageService.ts` (`mockUploadToStorage`) is **deprecated** and unreferenced by active domain flows. All active upload flows (proofs, documents, photos, dispute evidence) consume `getStorageAdapter()` from `src/services/storage/index.ts`. Removal of `mockStorageService.ts` is tracked under task **P5-06**.

---

## Usage Example

```ts
import { getStorageAdapter } from '../services/storage/index.js';

const storage = getStorageAdapter();
const key = `shipments/${shipmentId}/proofs/${uuid}.jpg`;
const { url, key: storedKey } = await storage.uploadFile(file.buffer, file.mimetype, key);
```

