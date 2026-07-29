import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { createLedgerBlock } from './ledger.repo.js';

describe('ledger repo', () => {
  it('throws AppError 400 when milestoneEvent and eventType are missing', async () => {
    await expect(createLedgerBlock({ shipmentId: '671000000000000000000001' })).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.BAD_REQUEST,
      message: 'milestoneEvent or eventType is required',
    });
    await expect(createLedgerBlock({ shipmentId: '671000000000000000000001' })).rejects.toBeInstanceOf(
      AppError
    );
  });
});
