import type { DeliveryConfirmedEvent, DeliverySuccessEvent } from '../../shared/types/chain.js';
import { CHAIN_EVENT_NAMES } from '../../shared/types/chain.js';
import {
  DeliveryClassification,
  ShipmentDelivery,
  type IDeliveryEventRecord,
  type IShipmentDelivery,
} from './shipmentDelivery.model.js';
import { Shipment } from './shipments.model.js';

export type DeliveryChainEvent = DeliverySuccessEvent | DeliveryConfirmedEvent;

export type RecordDeliveryOutcome = 'created' | 'updated' | 'duplicate';

/**
 * Deadline convention (#1043): a delivery is ON_TIME when
 * `delivery_time <= deadline` — the boundary instant itself is on time — and
 * LATE only strictly after it. Matches the contract (`now > deadline` is late).
 * Both sides are compared as absolute instants (UTC ms); `delivery_time` is the
 * chain's unix-seconds ledger timestamp, never the server clock.
 */
export function classifyDelivery(
  deliveryTime: Date,
  deadline?: Date | null
): DeliveryClassification {
  if (!deadline || Number.isNaN(deadline.getTime())) return DeliveryClassification.UNKNOWN;
  return deliveryTime.getTime() <= deadline.getTime()
    ? DeliveryClassification.ON_TIME
    : DeliveryClassification.LATE;
}

/** Chain `delivery_time` (unix seconds, decimal string) → Date. */
export function chainSecondsToDate(seconds: string): Date {
  return new Date(Number(BigInt(seconds) * BigInt(1000)));
}

function toEventRecord(event: DeliveryChainEvent): IDeliveryEventRecord {
  return {
    eventId: event.id,
    txHash: event.tx_hash,
    ledger: event.ledger,
    deliveredAt: chainSecondsToDate(event.data[3]),
    actor: event.data[4],
  };
}

/**
 * Idempotently fold a `delivery_success` / `delivery_confirmed` event into the
 * per-shipment `ShipmentDelivery` record.
 *
 * - Identity: `event.id`. Re-delivering an already-recorded event is a no-op,
 *   so replays never duplicate rows or flip the classification.
 * - Ordering: either topic may arrive first; `delivery_success` is authoritative
 *   for `deliveryTime` once seen, otherwise `delivery_confirmed` supplies it.
 * - Classification: computed once from the shipment deadline and then frozen.
 *   It is recomputed only while still UNKNOWN (deadline/shipment not yet known).
 */
export async function recordDeliveryEvent(
  event: DeliveryChainEvent
): Promise<RecordDeliveryOutcome> {
  const chainShipmentId = event.data[0];
  const isSuccess = event.name === CHAIN_EVENT_NAMES.DELIVERY_SUCCESS;
  const slot = isSuccess ? 'success' : 'confirmed';
  const record = toEventRecord(event);

  const existing = await ShipmentDelivery.findOne({ chainShipmentId }).lean<IShipmentDelivery>();
  if (existing?.success?.eventId === event.id || existing?.confirmed?.eventId === event.id) {
    return 'duplicate';
  }
  // A different event for an already-filled slot (distinct id) is also ignored: the
  // contract emits each topic once per shipment, so this can only be a re-emission.
  if (existing?.[slot]) return 'duplicate';

  const successTime = isSuccess ? record.deliveredAt : existing?.success?.deliveredAt;
  const deliveryTime = successTime ?? record.deliveredAt;

  let shipmentId = existing?.shipmentId;
  let deadline = existing?.deadline;
  let classification = existing?.classification ?? DeliveryClassification.UNKNOWN;
  if (classification === DeliveryClassification.UNKNOWN) {
    const shipment = await Shipment.findOne({ chainShipmentId }).lean<{
      _id: IShipmentDelivery['shipmentId'];
      expectedDelivery?: Date;
    }>();
    shipmentId = shipment?._id ?? shipmentId;
    deadline = shipment?.expectedDelivery ?? deadline;
    classification = classifyDelivery(deliveryTime, deadline);
  }

  const set = {
    deliveryTime,
    classification,
    [slot]: record,
    ...(isSuccess ? { carrier: record.actor } : { receiver: record.actor }),
    ...(shipmentId !== undefined && { shipmentId }),
    ...(deadline !== undefined && { deadline }),
  };

  if (!existing) {
    try {
      await ShipmentDelivery.create({ chainShipmentId, ...set });
      return 'created';
    } catch (err) {
      // Lost a create race with a concurrent indexer: fall through to the guarded update.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }

  // Guarded by "slot still empty" so a concurrent duplicate can never overwrite.
  const res = await ShipmentDelivery.updateOne(
    { chainShipmentId, [slot]: { $exists: false } },
    { $set: set }
  );
  return res.modifiedCount > 0 ? 'updated' : 'duplicate';
}

/** Dry-run helper: has this event already been folded in? */
export async function isDeliveryEventRecorded(event: DeliveryChainEvent): Promise<boolean> {
  return (
    (await ShipmentDelivery.exists({
      chainShipmentId: event.data[0],
      $or: [{ 'success.eventId': event.id }, { 'confirmed.eventId': event.id }],
    })) !== null
  );
}
