import mongoose from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export interface ITemplate {
  _id?: string;
  name: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

const TemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TemplateSchema.plugin(isoDatePlugin);

// Soft-delete pre-hooks: exclude deleted records from default queries
TemplateSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

TemplateSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

// Strip internal fields from JSON output
TemplateSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const result = ret as Record<string, unknown>;
    delete result.__v;
    return result;
  },
});

export const TemplateModel = mongoose.model<ITemplate>('Template', TemplateSchema);
