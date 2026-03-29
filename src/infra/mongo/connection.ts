import mongoose from 'mongoose';
import { env } from '../../env.js';

let testMongoServer: import('mongodb-memory-server').MongoMemoryServer | null = null;

export async function connectMongo(mongoUri: string) {
  if (env.NODE_ENV === 'test') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    if (!testMongoServer) testMongoServer = await MongoMemoryServer.create();
    await mongoose.connect(testMongoServer.getUri());
  } else {
    await mongoose.connect(mongoUri);
  }
  console.log('MongoDB connected');
}

export async function disconnectMongo() {
  await mongoose.disconnect();
  if (env.NODE_ENV === 'test' && testMongoServer) {
    await testMongoServer.stop();
    testMongoServer = null;
  }
}
