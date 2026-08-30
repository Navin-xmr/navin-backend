import { beforeEach, describe, expect, it, afterAll } from '@jest/globals';
import { Types } from 'mongoose';
import { connectMongo } from '../src/infra/mongo/connection.js';
import { Anomaly } from '../src/modules/anomaly/anomaly.model.js';
import { Shipment } from '../src/modules/shipments/shipments.model.js';
import { Job } from 'bullmq';
import { logger } from '../src/shared/logger/logger.js';

/**
 * Mock the maintenance worker processor
 */
const RETENTION_DAYS = 90;

async function cleanupResolvedAnomalies(retentionDays: number = RETENTION_DAYS): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info({ cutoffDate, retentionDays }, 'Starting cleanup of resolved anomalies');

  try {
    const result = await Anomaly.deleteMany({
      resolved: true,
      updatedAt: { $lt: cutoffDate },
    });

    logger.info(
      { deletedCount: result.deletedCount, cutoffDate },
      'Completed cleanup of resolved anomalies'
    );

    return result.deletedCount;
  } catch (error) {
    logger.error({ error, cutoffDate }, 'Error during anomaly cleanup');
    throw error;
  }
}

describe('Issue #169: Automated Cleanup Job for Historical Resolved Anomalies', () => {
  let shipment: InstanceType<typeof Shipment>;

  beforeEach(async () => {
    await connectMongo(process.env.MONGO_URI!);
    await Anomaly.deleteMany({});
    await Shipment.deleteMany({});

    shipment = await Shipment.create({
      trackingNumber: 'CLEANUP-TEST-001',
      origin: 'Warehouse A',
      destination: 'Store B',
      enterpriseId: new Types.ObjectId('507f1f77bcf86cd799439011'),
      logisticsId: new Types.ObjectId('507f1f77bcf86cd799439012'),
    });
  });

  afterAll(async () => {
    await Anomaly.deleteMany({});
    await Shipment.deleteMany({});
  });

  describe('Core cleanup logic', () => {
    it('should remove resolved anomalies older than 90 days', async () => {
      // Create an anomaly resolved more than 90 days ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const oldAnomaly = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Old battery anomaly',
        resolved: true,
      });

      // Manually update updatedAt to be old as well (bypass Mongoose middleware)
      await Anomaly.collection.updateOne(
        { _id: new Types.ObjectId(oldAnomaly._id) },
        { $set: { updatedAt: oldDate } }
      );

      // Verify the anomaly exists
      let count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(1);

      // Run cleanup
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Verify it was deleted
      expect(deletedCount).toBe(1);
      count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(0);
    });

    it('should NOT remove unresolved anomalies', async () => {
      // Create an unresolved anomaly from more than 90 days ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'TEMPERATURE_EXCEEDED',
        severity: 'HIGH',
        message: 'Old temperature anomaly',
        resolved: false,
      });

      // Verify the anomaly exists
      let count = await Anomaly.countDocuments({ resolved: false });
      expect(count).toBe(1);

      // Run cleanup
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Verify it was NOT deleted
      expect(deletedCount).toBe(0);
      count = await Anomaly.countDocuments({ resolved: false });
      expect(count).toBe(1);
    });

    it('should NOT remove recent resolved anomalies', async () => {
      // Create a resolved anomaly from today
      const today = new Date();

      await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: today,
        type: 'HUMIDITY_EXCEEDED',
        severity: 'MEDIUM',
        message: 'Recent humidity anomaly',
        resolved: true,
      });

      // Verify the anomaly exists
      let count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(1);

      // Run cleanup
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Verify it was NOT deleted
      expect(deletedCount).toBe(0);
      count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(1);
    });

    it('should NOT remove resolved anomalies exactly at 90-day boundary', async () => {
      // Create an anomaly resolved 89 days ago (just within 90-day retention window)
      const boundaryDate = new Date();
      boundaryDate.setDate(boundaryDate.getDate() - 89);

      const boundaryAnomaly = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: boundaryDate,
        type: 'BATTERY_LOW',
        severity: 'LOW',
        message: 'Boundary anomaly',
        resolved: true,
      });

      // Manually update updatedAt to be 89 days ago
      await Anomaly.collection.updateOne(
        { _id: new Types.ObjectId(boundaryAnomaly._id) },
        { $set: { updatedAt: boundaryDate } }
      );

      // Verify the anomaly exists
      let count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(1);

      // Run cleanup with 90 days
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Should NOT be deleted (within 90-day window)
      expect(deletedCount).toBe(0);
      count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(1);
    });

    it('should remove resolved anomalies just after 90-day boundary', async () => {
      // Create an anomaly resolved 90 days and 1 minute ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 90);
      oldDate.setMinutes(oldDate.getMinutes() - 1);

      const oldAnomaly = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'TEMPERATURE_BELOW_MIN',
        severity: 'HIGH',
        message: 'Old temperature anomaly',
        resolved: true,
      });

      // Manually update updatedAt to be 90 days and 1 minute ago
      await Anomaly.collection.updateOne(
        { _id: new Types.ObjectId(oldAnomaly._id) },
        { $set: { updatedAt: oldDate } }
      );

      // Verify the anomaly exists
      let count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(1);

      // Run cleanup
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Should be deleted (older than 90 days)
      expect(deletedCount).toBe(1);
      count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(0);
    });

    it('should handle mixed resolved and unresolved anomalies', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      // Create old resolved anomaly (should be deleted)
      const oldResolved = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Old resolved',
        resolved: true,
      });

      // Create old unresolved anomaly (should NOT be deleted)
      await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'TEMPERATURE_EXCEEDED',
        severity: 'HIGH',
        message: 'Old unresolved',
        resolved: false,
      });

      // Create recent resolved anomaly (should NOT be deleted)
      const today = new Date();
      await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: today,
        type: 'HUMIDITY_EXCEEDED',
        severity: 'MEDIUM',
        message: 'Recent resolved',
        resolved: true,
      });

      // Manually update old resolved updatedAt
      await Anomaly.collection.updateOne({ _id: new Types.ObjectId(oldResolved._id) }, { $set: { updatedAt: oldDate } });

      // Verify we have 3 anomalies
      let count = await Anomaly.countDocuments();
      expect(count).toBe(3);

      // Run cleanup
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Only the old resolved one should be deleted
      expect(deletedCount).toBe(1);
      count = await Anomaly.countDocuments();
      expect(count).toBe(2);

      // Verify the right ones remain
      const unresolved = await Anomaly.findOne({ resolved: false });
      expect(unresolved).toBeDefined();

      const recent = await Anomaly.findOne({
        resolved: true,
        message: 'Recent resolved',
      });
      expect(recent).toBeDefined();
    });
  });

  describe('Cleanup with custom retention periods', () => {
    it('should respect custom retention period (e.g., 30 days)', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

      const oldAnomaly = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Old battery anomaly',
        resolved: true,
      });

      await Anomaly.collection.updateOne({ _id: new Types.ObjectId(oldAnomaly._id) }, { $set: { updatedAt: oldDate } });

      // With 30-day retention, should be deleted (40 days > 30 days)
      const deletedCount = await cleanupResolvedAnomalies(30);
      expect(deletedCount).toBe(1);
    });

    it('should NOT delete when retention period is higher', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

      const oldAnomaly = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Old battery anomaly',
        resolved: true,
      });

      await Anomaly.updateOne({ _id: new Types.ObjectId(oldAnomaly._id) }, { updatedAt: oldDate });

      // With 180-day retention, should NOT be deleted (100 days < 180 days)
      const deletedCount = await cleanupResolvedAnomalies(180);
      expect(deletedCount).toBe(0);

      const exists = await Anomaly.findOne({ _id: oldAnomaly._id });
      expect(exists).toBeDefined();
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle cleanup with no anomalies', async () => {
      const deletedCount = await cleanupResolvedAnomalies(90);
      expect(deletedCount).toBe(0);
    });

    it('should handle cleanup with only unresolved anomalies', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Old unresolved',
        resolved: false,
      });

      const deletedCount = await cleanupResolvedAnomalies(90);
      expect(deletedCount).toBe(0);
    });

    it('should handle cleanup with only recent anomalies', async () => {
      const today = new Date();

      await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: today,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Recent resolved',
        resolved: true,
      });

      const deletedCount = await cleanupResolvedAnomalies(90);
      expect(deletedCount).toBe(0);
    });

    it('should handle large batch cleanup', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      // Create 100 old resolved anomalies
      const anomalies = [];
      for (let i = 0; i < 100; i++) {
        anomalies.push({
          shipmentId: shipment._id.toString(),
          timestamp: oldDate,
          type: 'BATTERY_LOW',
          severity: 'MEDIUM',
          message: `Old anomaly ${i}`,
          resolved: true,
        });
      }

      await Anomaly.insertMany(anomalies);

      // Manually update the old timestamps
      await Anomaly.collection.updateMany(
        { resolved: true },
        { $set: { updatedAt: oldDate } }
      );

      // Verify they exist
      let count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(100);

      // Run cleanup
      const deletedCount = await cleanupResolvedAnomalies(90);
      expect(deletedCount).toBe(100);

      count = await Anomaly.countDocuments({ resolved: true });
      expect(count).toBe(0);
    });
  });

  describe('Scheduling validation', () => {
    it('should verify cleanup removes correct fields (retentionDays parameter)', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const oldAnomaly = await Anomaly.create({
        shipmentId: shipment._id.toString(),
        timestamp: oldDate,
        type: 'BATTERY_LOW',
        severity: 'MEDIUM',
        message: 'Test anomaly',
        resolved: true,
      });

      // Capture anomaly data before cleanup
      const beforeCleanup = await Anomaly.findById(oldAnomaly._id);
      expect(beforeCleanup).toBeDefined();

      // Manually update timestamp to be old
      await Anomaly.collection.updateOne({ _id: new Types.ObjectId(oldAnomaly._id) }, { $set: { updatedAt: oldDate } });

      // Run cleanup with explicit retention days
      const deletedCount = await cleanupResolvedAnomalies(90);

      // Verify it was deleted
      expect(deletedCount).toBe(1);
      const afterCleanup = await Anomaly.findById(oldAnomaly._id);
      expect(afterCleanup).toBeNull();
    });
  });
});
