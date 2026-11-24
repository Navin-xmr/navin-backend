import mongoose, { Schema } from 'mongoose';

export interface IndexerDeadLetterDocument {
  cursor: string;
  contractId: string;
  rawPayload: unknown;
  candidatePayload: unknown;
  error: string;
  status: 'pending' | 'replayed';
  replayError?: string;
  replayedAt?: Date;
}

const IndexerDeadLetterSchema = new Schema<IndexerDeadLetterDocument>(
  {
    cursor: { type: String, required: true },
    contractId: { type: String, required: true },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    candidatePayload: { type: Schema.Types.Mixed, required: true },
    error: { type: String, required: true },
    status: { type: String, enum: ['pending', 'replayed'], default: 'pending', required: true },
    replayError: { type: String },
    replayedAt: { type: Date },
  },
  { timestamps: true }
);

IndexerDeadLetterSchema.index({ status: 1, createdAt: 1 });

export const IndexerDeadLetterModel =
  mongoose.models.IndexerDeadLetter ||
  mongoose.model<IndexerDeadLetterDocument>('IndexerDeadLetter', IndexerDeadLetterSchema);
