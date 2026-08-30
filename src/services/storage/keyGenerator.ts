/**
 * Storage key generation utilities.
 *
 * Creates deterministic, hierarchical keys for file organization:
 * - Prefix by shipment ID for easy ops
 * - Add unique suffix (UUID or timestamp) to avoid overwrites
 * - Include file extension for clarity
 */

import { randomUUID } from 'crypto';

/**
 * Generate storage key for shipment proof uploads.
 *
 * Format: shipments/{shipmentId}/proofs/{uuid}.{ext}
 */
export function generateProofKey(shipmentId: string, originalFilename: string): string {
  const ext = getExtension(originalFilename);
  const uuid = randomUUID();
  return `shipments/${shipmentId}/proofs/${uuid}${ext}`;
}

/**
 * Generate storage key for shipment document uploads.
 *
 * Format: shipments/{shipmentId}/documents/{docType}/{uuid}.{ext}
 */
export function generateDocumentKey(
  shipmentId: string,
  docType: string,
  originalFilename: string
): string {
  const ext = getExtension(originalFilename);
  const uuid = randomUUID();
  return `shipments/${shipmentId}/documents/${docType}/${uuid}${ext}`;
}

/**
 * Generate storage key for shipment photo uploads.
 *
 * Format: shipments/{shipmentId}/photos/{uuid}.{ext}
 */
export function generatePhotoKey(shipmentId: string, originalFilename: string): string {
  const ext = getExtension(originalFilename);
  const uuid = randomUUID();
  return `shipments/${shipmentId}/photos/${uuid}${ext}`;
}

/**
 * Generate storage key for dispute evidence uploads.
 *
 * Format: shipments/{shipmentId}/disputes/{disputeId}/{uuid}.{ext}
 */
export function generateDisputeEvidenceKey(
  shipmentId: string,
  disputeId: string,
  originalFilename: string
): string {
  const ext = getExtension(originalFilename);
  const uuid = randomUUID();
  return `shipments/${shipmentId}/disputes/${disputeId}/${uuid}${ext}`;
}

/**
 * Extract file extension from filename or MIME type.
 * Preserves original extension if present, otherwise derives from MIME type.
 */
function getExtension(filename: string): string {
  // Extract extension from filename
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  if (match) {
    return `.${match[1].toLowerCase()}`;
  }

  // Default fallback
  return '';
}
