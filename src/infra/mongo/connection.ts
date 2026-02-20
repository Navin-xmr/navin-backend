import mongoose from 'mongoose';

export async function connectMongo(mongoUri: string) {
  await mongoose.connect(mongoUri);
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
