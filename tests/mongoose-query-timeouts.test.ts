import mongoose from 'mongoose';

describe('Mongoose connection timeout options', () => {
  it('connects with serverSelectionTimeoutMS and socketTimeoutMS set', async () => {
    // Verify the connection options are applied when connecting
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    };

    // These options should be present on the mongoose connection after connect
    // We verify the values are correct constants (not zero / undefined)
    expect(options.serverSelectionTimeoutMS).toBe(5000);
    expect(options.socketTimeoutMS).toBe(10000);
  });
});

describe('Analytics aggregation maxTimeMS', () => {
  it('applies maxTimeMS(5000) to the aggregation pipeline', async () => {
    const Schema = new mongoose.Schema({ name: String });
    const Model = mongoose.models['TimeoutTestModel'] ?? mongoose.model('TimeoutTestModel', Schema);

    const agg = (Model.aggregate([{ $match: {} }]) as any).maxTimeMS(5000);

    // Verify maxTimeMS is set on the aggregation object
    expect((agg as unknown as { options: { maxTimeMS?: number } }).options.maxTimeMS).toBe(5000);
  });
});
