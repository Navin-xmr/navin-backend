import type { Schema } from 'mongoose';

/**
 * Mongoose plugin that handles soft deletion.
 *
 * Functions:
 * 1. Adds a `deletedAt` field to the schema (Date type, default null).
 * 2. Registers pre-hooks for find, findOne, findOneAndUpdate, and countDocuments queries
 *    to automatically filter out documents that have been soft-deleted (where `deletedAt` is not null).
 * 3. Registers a pre-aggregate hook to inject a `$match: { deletedAt: null }` stage at the
 *    beginning of the aggregation pipeline.
 *
 * @param schema - The Mongoose schema to apply the soft-delete functionality.
 */
export function softDeletePlugin(schema: Schema): void {
  // Add the deletedAt field to track soft-delete status
  schema.add({
    deletedAt: { type: Date, default: null },
  });

  // Apply query filters to exclude soft-deleted documents
  schema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
    this.where({ deletedAt: null });
  });

  // Apply aggregation pipeline filters to exclude soft-deleted documents
  schema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { deletedAt: null } });
  });
}
