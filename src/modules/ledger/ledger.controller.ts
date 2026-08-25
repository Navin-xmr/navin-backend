import type { Request, Response } from 'express';
import * as ledgerService from './ledger.service.js';
import type { GetLedgerBlocksQuery, LedgerBlockIdParam } from './ledger.validation.js';

/**
 * Lists ledger blocks with optional filters and cursor pagination.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.query.shipmentId - Optional shipment filter.
 * @param req.query.eventType - Optional milestone event type filter.
 * @param req.query.limit - Page size (default 20, max 100).
 * @param req.query.cursor - Optional cursor for the next page.
 * @returns HTTP 200 with envelope { success, message, data, meta } (	otal, hasMore, 
extCursor).
 * @throws {AppError} 401 ERR_AUTH_INVALID - when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED - when the caller lacks an allowed role.
 * @throws {AppError} 400 VALIDATION_ERROR - when query validation fails.
 */
export const getLedgerBlocks = async (req: Request, res: Response) => {
  const query = req.query as unknown as GetLedgerBlocksQuery;
  const { shipmentId, milestoneEvent, limit = 20, cursor } = query;
  const result = await ledgerService.getLedgerBlocksService({
    shipmentId,
    milestoneEvent,
    limit: Number(limit),
    cursor,
  });

  return res.status(200).json({
    data: result.data,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    total: result.total,
  });
};

/**
 * Retrieves a single ledger block by id.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.params.id - Ledger block id.
 * @returns HTTP 200 with envelope { success, message, data } containing the block.
 * @throws {AppError} 401 ERR_AUTH_INVALID - when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED - when the caller lacks an allowed role.
 * @throws {AppError} 404 ERR_LEDGER_BLOCK_NOT_FOUND - when the block does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR - when the id param is invalid.
 */
export const getLedgerBlockById = async (req: Request<LedgerBlockIdParam>, res: Response) => {
  const block = await ledgerService.getLedgerBlockByIdService(req.params.id);
  return res.status(200).json({ data: block });
};