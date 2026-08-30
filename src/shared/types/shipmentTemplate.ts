/**
 * Describes the reusable shipment field presets within a template.
 */
export interface IShipmentTemplateFields {
  origin?: string;
  destination?: string;
  itemDescription?: string;
  weight?: number;
  recipientName?: string;
  recipientContact?: string;
}

/**
 * Represents a Shipment Template document stored in MongoDB.
 */
export interface IShipmentTemplate {
  _id: string;
  name: string;
  fields: IShipmentTemplateFields;
  organizationId: string;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
