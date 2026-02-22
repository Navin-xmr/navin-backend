import request from 'supertest';
import { jest } from '@jest/globals';

// Create an in-memory mock for the Shipment model
const mockData: any[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  const Shipment = {
    find: jest.fn((query: any) => {
      const arr = mockData.filter(d => !query || !query.status || d.status === query.status);
      return {
        skip: (s: number) => ({
          limit: (l: number) => Promise.resolve(arr.slice(s, s + l)),
        }),
      };
    }),
    countDocuments: jest.fn((query: any) => Promise.resolve(mockData.filter(d => !query || !query.status || d.status === query.status).length)),
    deleteMany: jest.fn(() => { mockData.length = 0; return Promise.resolve(); }),
    create: jest.fn((doc: any) => { const d = { ...doc, _id: String(mockData.length) }; mockData.push(d); return Promise.resolve(d); }),
    findByIdAndUpdate: jest.fn((id: any, update: any) => {
      const idx = mockData.findIndex(d => d._id === id);
      if (idx === -1) return Promise.resolve(null);
      mockData[idx] = { ...mockData[idx], ...update };
      return Promise.resolve(mockData[idx]);
    }),
  };
  const __setMockData = (arr: any[]) => { mockData.splice(0, mockData.length, ...arr); };
  const __getMockData = () => mockData;
  return { Shipment, __setMockData, __getMockData };
});

describe('Shipments API (mocked DB)', () => {
  let app: any;
  let shipmentsModel: any;

  beforeAll(async () => {
    shipmentsModel = await import('../src/modules/shipments/shipments.model.js');
    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  beforeEach(() => {
    shipmentsModel.__setMockData([]);
  });

  it('should paginate shipments', async () => {
    for (let i = 0; i < 15; i++) {
      await shipmentsModel.Shipment.create({
        trackingNumber: `TN${i}`,
        origin: 'A',
        destination: 'B',
        enterpriseId: `ent${i}`,
        logisticsId: `log${i}`,
        status: 'CREATED',
      });
    }
    const res = await request(app).get('/api/shipments?page=2&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);
    expect(res.body.page).toBe(2);
    expect(res.body.total).toBe(15);
  });

  it('should filter shipments by status', async () => {
    await shipmentsModel.Shipment.create({ trackingNumber: 'TN1', origin: 'A', destination: 'B', enterpriseId: 'ent1', logisticsId: 'log1', status: 'IN_TRANSIT' });
    await shipmentsModel.Shipment.create({ trackingNumber: 'TN2', origin: 'A', destination: 'B', enterpriseId: 'ent2', logisticsId: 'log2', status: 'DELIVERED' });
    const res = await request(app).get('/api/shipments?status=IN_TRANSIT');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('IN_TRANSIT');
  });
});
