// Integration test that hits the Stellar testnet.
//
// To run:
//   1. Fund a testnet account via Friendbot:
//      curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
//   2. Set the env var:  export STELLAR_SECRET_KEY="S..."
//   3. Change `describe.skip` to `describe` below
//   4. Run:  npx jest tests/stellar.integration.test.ts --testTimeout=30000

describe.skip('Stellar Service - Integration (Testnet)', () => {
  let tokenizeShipment: Awaited<typeof import('../src/services/stellar.service.js')>['tokenizeShipment'];

  beforeAll(async () => {
    const mod = await import('../src/services/stellar.service.js');
    tokenizeShipment = mod.tokenizeShipment;
  });

  it('should tokenize a shipment on the Stellar testnet', async () => {
    const shipmentId = `integ-${Date.now()}`;

    const result = await tokenizeShipment({
      trackingNumber: 'INT-TEST-001',
      origin: 'San Francisco',
      destination: 'Tokyo',
      shipmentId,
    });

    expect(result.stellarTxHash).toEqual(expect.any(String));
    expect(result.stellarTxHash.length).toBeGreaterThan(0);

    expect(result.stellarTokenId).toMatch(/^stellar:/);
    expect(result.stellarTokenId).toContain(shipmentId);

    console.log('Tx hash:', result.stellarTxHash);
    console.log('Verify:  https://stellar.expert/explorer/testnet/tx/' + result.stellarTxHash);
  }, 30_000);

  it('should produce unique token IDs for different shipments', async () => {
    const first = await tokenizeShipment({
      trackingNumber: 'INT-UNIQ-001',
      origin: 'Berlin',
      destination: 'Sydney',
      shipmentId: `uniq-a-${Date.now()}`,
    });

    const second = await tokenizeShipment({
      trackingNumber: 'INT-UNIQ-002',
      origin: 'Paris',
      destination: 'Dubai',
      shipmentId: `uniq-b-${Date.now()}`,
    });

    expect(first.stellarTokenId).not.toBe(second.stellarTokenId);
    expect(first.stellarTxHash).not.toBe(second.stellarTxHash);
  }, 60_000);
});
