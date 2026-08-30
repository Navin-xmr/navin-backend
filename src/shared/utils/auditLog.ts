import { logger } from '../logger/logger.js';
import { AuditLog } from '../../modules/audit-logs/auditLogs.model.js';
import { isValidObjectId } from 'mongoose';

export type AuditAction =
  | 'SHIPMENT_STATUS_CHANGED'
  | 'SHIPMENT_CREATED'
  | 'PROOF_UPLOADED'
  | 'TELEMETRY_ANCHORED'
  | 'SETTLEMENT_RELEASED'
  | 'ANOMALY_DETECTED'
  | 'USER_INVITED'
  | 'DISPUTE_OPENED'
  | 'RBAC_ROLE_MODIFIED'
  | 'API_KEY_GENERATED';

export interface AuditLogParams {
  userId: string;
  action: AuditAction;
  resource?: string;
  resourceId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

function inferResource(action: AuditAction): string {
  if (
    action === 'SHIPMENT_STATUS_CHANGED' ||
    action === 'SHIPMENT_CREATED' ||
    action === 'PROOF_UPLOADED' ||
    action === 'DISPUTE_OPENED'
  ) {
    return 'SHIPMENT';
  }

  if (action === 'TELEMETRY_ANCHORED') {
    return 'TELEMETRY';
  }

  if (action === 'SETTLEMENT_RELEASED') {
    return 'PAYMENT';
  }

  if (action === 'ANOMALY_DETECTED') {
    return 'ANOMALY';
  }

  if (action === 'USER_INVITED') {
    return 'USER';
  }

  if (action === 'API_KEY_GENERATED') {
    return 'API_KEY';
  }

  return 'USER';
}

export function auditLog(params: AuditLogParams): void {
  const resource = params.resource ?? inferResource(params.action);

  logger.info(
    {
      audit: true,
      userId: params.userId,
      action: params.action,
      resource,
      resourceId: params.resourceId,
      timestamp: params.timestamp.toISOString(),
      ...(params.metadata && { metadata: params.metadata }),
    },
    `AUDIT: ${params.action}`
  );

  if (!isValidObjectId(params.userId)) {
    return;
  }

  void AuditLog.create({
    userId: params.userId,
    action: params.action,
    resource,
    resourceId: params.resourceId,
    timestamp: params.timestamp,
    metadata: params.metadata,
  }).catch(error => {
    logger.error(
      { err: error, action: params.action, userId: params.userId },
      'Failed to persist audit log'
    );
  });
}
