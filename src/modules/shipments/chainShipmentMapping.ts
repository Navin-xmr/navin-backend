import type { ShipmentCreatedEvent } from '../../shared/types/chain.js';

/** P13-08 / #1028 — pure mapping decision shared by the indexer and fixture tests. */
export function resolveShipmentCreatedMapping(
  event: ShipmentCreatedEvent,
  shipment: { id: string } | null
): {
  chainShipmentId: string;
  shipmentId: string | null;
  status: 'MAPPED' | 'QUARANTINED';
  dataHash: string;
  sender: string;
  receiver: string;
} {
  const [sender, receiver, dataHash] = event.data;
  return {
    chainShipmentId: event.topic[1],
    shipmentId: shipment?.id ?? null,
    // An orphan is quarantined (record kept for the outbox race), not dropped.
    status: shipment ? 'MAPPED' : 'QUARANTINED',
    dataHash,
    sender,
    receiver,
  };
}
