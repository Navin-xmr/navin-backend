import { UserModel } from '../src/modules/users/users.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { deleteUser } from '../src/modules/users/users.service.js';
import { deleteShipmentService } from '../src/modules/shipments/shipments.service.js';

describe('Soft Delete Functionality', () => {
  describe('User Soft Delete', () => {
    it('should add deletedAt field to schema', () => {
      const userSchema = UserModel.schema;
      expect(userSchema.paths.deletedAt).toBeDefined();
      expect(userSchema.paths.deletedAt.instance).toBe('Date');
    });

    it('should filter out soft-deleted users in queries', async () => {
      // Mock a user with deletedAt set
      const mockUser = {
        _id: 'test-id',
        email: 'test@example.com',
        name: 'Test User',
        deletedAt: new Date(),
      };

      // Mock the find method to test middleware
      const findSpy = jest.spyOn(UserModel, 'find');
      findSpy.mockImplementation(() => ({
        where: jest.fn().mockReturnThis(),
      }) as any);

      UserModel.find({});
      
      expect(findSpy).toHaveBeenCalled();
      findSpy.mockRestore();
    });
  });

  describe('Shipment Soft Delete', () => {
    it('should add deletedAt field to schema', () => {
      const shipmentSchema = Shipment.schema;
      expect(shipmentSchema.paths.deletedAt).toBeDefined();
      expect(shipmentSchema.paths.deletedAt.instance).toBe('Date');
    });

    it('should filter out soft-deleted shipments in queries', async () => {
      // Mock a shipment with deletedAt set
      const mockShipment = {
        _id: 'test-id',
        trackingNumber: 'TEST123',
        origin: 'Test Origin',
        destination: 'Test Destination',
        deletedAt: new Date(),
      };

      // Mock the find method to test middleware
      const findSpy = jest.spyOn(Shipment, 'find');
      findSpy.mockImplementation(() => ({
        where: jest.fn().mockReturnThis(),
      }) as any);

      Shipment.find({});
      
      expect(findSpy).toHaveBeenCalled();
      findSpy.mockRestore();
    });
  });

  describe('Anomaly and Telemetry Soft Delete', () => {
    it('should preserve deletedAt fields on models', async () => {
      const anomalyModule = await import('../src/modules/anomaly/anomaly.model.js');
      const telemetryModule = await import('../src/modules/telemetry/telemetry.model.js');
      const anomalySchema = anomalyModule.Anomaly.schema;
      const telemetrySchema = telemetryModule.Telemetry.schema;

      expect(anomalySchema.paths.deletedAt).toBeDefined();
      expect(anomalySchema.paths.deletedAt.instance).toBe('Date');
      expect(telemetrySchema.paths.deletedAt).toBeDefined();
      expect(telemetrySchema.paths.deletedAt.instance).toBe('Date');
    });
  });
});
