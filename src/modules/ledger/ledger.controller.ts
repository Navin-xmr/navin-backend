import type { Request, Response } from 'express';
import * as ledgerService from './ledger.service.js';
import type { GetLedgerBlocksQuery, LedgerBlockIdParam } from './ledger.validation.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Lists ledger blocks with optional filters and cursor pagination.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.query.shipmentId - Optional shipment filter.
 * @param req.query.eventType - Optional milestone event type filter.
 * @param req.query.limit - Page size (default 20, max 100).
 * @param req.query.cursor - Optional cursor for the next page.
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`total`, `hasMore`, `nextCursor`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks an allowed role.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
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

  const meta = {
    total: result.total,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
  };

  return sendResponse(res, 200, true, 'Ledger blocks retrieved', result.data, meta);
};

/**
 * Retrieves a single ledger block by id.
 * Requires auth and ADMIN / MANAGER / VIEWER.
 *
 * @param req.params.id - Ledger block id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the block.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks an allowed role.
 * @throws {AppError} 404 ERR_LEDGER_BLOCK_NOT_FOUND — when the block does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getLedgerBlockById = async (req: Request, res: Response) => {
  const params = req.params as unknown as LedgerBlockIdParam;
  const block = await ledgerService.getLedgerBlockByIdService(params.id);
  return sendResponse(res, 200, true, 'Ledger block retrieved', block);
};
