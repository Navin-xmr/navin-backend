import * as mongoose from 'mongoose';
import { logger } from '../../shared/logger/logger.js';

const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 10000,
  maxPoolSize: 10,
} as const;

export async function connectMongo(mongoUri: string) {
  let testMongoServer: import('mongodb-memory-server').MongoMemoryServer | null = null;

  if (process.env.NODE_ENV === 'test') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    testMongoServer = await MongoMemoryServer.create();
    mongoUri = testMongoServer.getUri();
  }

  const connectWithRetry = async () => {
    logger.info('Attempting MongoDB connection...');
    try {
      await mongoose.connect(mongoUri, MONGO_OPTIONS);
    } catch (err) {
      logger.error(err, 'MongoDB connection failed, retrying in 5s...');
      setTimeout(connectWithRetry, 5000);
    }
  };

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting to reconnect...');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully');
  });

  await connectWithRetry();
}

export async function disconnectMongo() {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
