import { jest } from '@jest/globals';

let mockStellarSecretKey: string | undefined = 'STEST_MOCK_SECRET_KEY_FOR_UNIT_TESTS';

const mockSign = jest.fn();
const mockTransaction = { sign: mockSign };

const mockLoadAccount = jest.fn<() => Promise<unknown>>();
const mockSubmitTransaction = jest.fn<() => Promise<unknown>>();

const mockBuilderInstance = {
  addOperation: jest.fn(),
  setTimeout: jest.fn(),
  build: jest.fn(),
};

const MockTransactionBuilder = jest.fn();
const mockFromSecret = jest.fn();
const mockManageData = jest.fn();

await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockReturnValue({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }),
  },
  Keypair: { fromSecret: mockFromSecret },
  TransactionBuilder: MockTransactionBuilder,
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Operation: { manageData: mockManageData },
  BASE_FEE: '100',
}));

await jest.unstable_mockModule('../src/config/index.js', () => ({
  config: {
    get stellarSecretKey() { return mockStellarSecretKey; },
    stellarNetwork: 'testnet',
  },
}));

const { tokenizeShipment } = await import('../src/services/stellar.service.js');

describe('Stellar Service - tokenizeShipment', () => {
  const shipmentData = {
    trackingNumber: 'TN-001',
    origin: 'New York',
    destination: 'London',
    shipmentId: 'ship-abc-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockStellarSecretKey = 'STEST_MOCK_SECRET_KEY_FOR_UNIT_TESTS';

    mockFromSecret.mockReturnValue({
      publicKey: () => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    });
    mockLoadAccount.mockResolvedValue({
      accountId: () => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    });
    mockSubmitTransaction.mockResolvedValue({ hash: 'mock-tx-hash-abc123' });
    mockManageData.mockReturnValue({ type: 'manageData' });

    MockTransactionBuilder.mockReturnValue(mockBuilderInstance);
    mockBuilderInstance.addOperation.mockReturnValue(mockBuilderInstance);
    mockBuilderInstance.setTimeout.mockReturnValue(mockBuilderInstance);
    mockBuilderInstance.build.mockReturnValue(mockTransaction);
  });

  it('should return { stellarTokenId, stellarTxHash } on success', async () => {
    const result = await tokenizeShipment(shipmentData);

    expect(result).toEqual({
      stellarTokenId: 'stellar:ship-abc-123:mock-tx-',
      stellarTxHash: 'mock-tx-hash-abc123',
    });
  });

  it('should throw when STELLAR_SECRET_KEY is not configured', async () => {
    mockStellarSecretKey = undefined;

    await expect(tokenizeShipment(shipmentData))
      .rejects.toThrow('STELLAR_SECRET_KEY is not configured');
  });

  it('should derive the public key and load the account from Horizon', async () => {
    await tokenizeShipment(shipmentData);

    expect(mockFromSecret).toHaveBeenCalledWith('STEST_MOCK_SECRET_KEY_FOR_UNIT_TESTS');
    expect(mockLoadAccount).toHaveBeenCalledWith('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  });

  it('should build a transaction with two manageData operations', async () => {
    await tokenizeShipment(shipmentData);

    expect(mockManageData).toHaveBeenCalledTimes(2);
    expect(mockManageData).toHaveBeenCalledWith({
      name: 'tracking:ship-abc-123',
      value: 'TN-001',
    });
    expect(mockManageData).toHaveBeenCalledWith({
      name: 'route:ship-abc-123',
      value: 'New York->London',
    });
  });

  it('should configure TransactionBuilder with TESTNET passphrase', async () => {
    await tokenizeShipment(shipmentData);

    expect(MockTransactionBuilder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fee: '100',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
    );
  });

  it('should set a 30-second timeout on the transaction', async () => {
    await tokenizeShipment(shipmentData);

    expect(mockBuilderInstance.setTimeout).toHaveBeenCalledWith(30);
  });

  it('should sign the transaction with the keypair and submit it', async () => {
    const keypairObj = { publicKey: () => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' };
    mockFromSecret.mockReturnValue(keypairObj);

    await tokenizeShipment(shipmentData);

    expect(mockSign).toHaveBeenCalledWith(keypairObj);
    expect(mockSubmitTransaction).toHaveBeenCalledWith(mockTransaction);
  });

  it('should propagate Horizon submission errors', async () => {
    mockSubmitTransaction.mockRejectedValue(new Error('Horizon: tx_failed'));

    await expect(tokenizeShipment(shipmentData))
      .rejects.toThrow('Horizon: tx_failed');
  });
});
