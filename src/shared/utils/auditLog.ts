import { logger } from '../logger/logger.js';
import { AuditLog } from '../../modules/audit-logs/auditLogs.model.js';
import { isValidObjectId } from 'mongoose';

export type AuditAction = 'SHIPMENT_STATUS_CHANGED' | 'RBAC_ROLE_MODIFIED' | 'API_KEY_GENERATED';

export interface AuditLogParams {
  userId: string;
  action: AuditAction;
  resource?: string;
  resourceId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

function inferResource(action: AuditAction): string {
  if (action === 'SHIPMENT_STATUS_CHANGED') {
    return 'SHIPMENT';
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
