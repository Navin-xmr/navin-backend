import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import type { IShipmentTemplate } from '../../shared/types/shipmentTemplate.js';

const ShipmentTemplateFieldsSchema = new Schema(
  {
    origin: { type: String },
    destination: { type: String },
    itemDescription: { type: String },
    weight: { type: Number },
    recipientName: { type: String },
    recipientContact: { type: String },
  },
  { _id: false }
);

const ShipmentTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    fields: { type: ShipmentTemplateFieldsSchema, required: true },
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ShipmentTemplateSchema.plugin(isoDatePlugin);

// Optimizes listing templates for a specific organization.
ShipmentTemplateSchema.index({ organizationId: 1, createdAt: -1 });

// Soft delete middleware — exclude deleted templates from all queries.
ShipmentTemplateSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

export const ShipmentTemplate = model<IShipmentTemplate>(
  'ShipmentTemplate',
  ShipmentTemplateSchema
);
