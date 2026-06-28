import { describe, it, expect } from '@jest/globals';
import {
  validateStatusTransition,
  ALLOWED_TRANSITIONS,
} from '../src/shared/constants/shipmentStateMachine.js';
import { ShipmentStatus } from '../src/shared/types/shipment.js';

describe('#286 - Shipment State Machine', () => {
  describe('ALLOWED_TRANSITIONS map', () => {
    it('CREATED can go to IN_TRANSIT and CANCELLED', () => {
      expect(ALLOWED_TRANSITIONS[ShipmentStatus.CREATED]).toEqual(
        expect.arrayContaining([ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED])
      );
    });

    it('IN_TRANSIT can go to DELIVERED and CANCELLED', () => {
      expect(ALLOWED_TRANSITIONS[ShipmentStatus.IN_TRANSIT]).toEqual(
        expect.arrayContaining([ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED])
      );
    });

    it('DELIVERED has no allowed transitions (terminal)', () => {
      expect(ALLOWED_TRANSITIONS[ShipmentStatus.DELIVERED]).toEqual([]);
    });

    it('CANCELLED has no allowed transitions (terminal)', () => {
      expect(ALLOWED_TRANSITIONS[ShipmentStatus.CANCELLED]).toEqual([]);
    });
  });

  describe('validateStatusTransition - valid transitions', () => {
    it('CREATED → IN_TRANSIT is valid', () => {
      expect(() =>
        validateStatusTransition(ShipmentStatus.CREATED, ShipmentStatus.IN_TRANSIT)
      ).not.toThrow();
    });

    it('CREATED → CANCELLED is valid', () => {
      expect(() =>
        validateStatusTransition(ShipmentStatus.CREATED, ShipmentStatus.CANCELLED)
      ).not.toThrow();
    });

    it('IN_TRANSIT → DELIVERED is valid', () => {
      expect(() =>
        validateStatusTransition(ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED)
      ).not.toThrow();
    });

    it('IN_TRANSIT → CANCELLED is valid', () => {
      expect(() =>
        validateStatusTransition(ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED)
      ).not.toThrow();
    });
  });

  describe('validateStatusTransition - invalid transitions', () => {
    it('CREATED → DELIVERED throws 400 with ERR_SHIPMENT_INVALID_TRANSITION', () => {
      expect(() =>
        validateStatusTransition(ShipmentStatus.CREATED, ShipmentStatus.DELIVERED)
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: 'ERR_SHIPMENT_INVALID_TRANSITION',
        })
      );
    });

    it('IN_TRANSIT → CREATED throws 400', () => {
      expect(() =>
        validateStatusTransition(ShipmentStatus.IN_TRANSIT, ShipmentStatus.CREATED)
      ).toThrow(
        expect.objectContaining({ statusCode: 400, code: 'ERR_SHIPMENT_INVALID_TRANSITION' })
      );
    });

    it('DELIVERED → any status throws 400 (terminal state)', () => {
      for (const next of [
        ShipmentStatus.CREATED,
        ShipmentStatus.IN_TRANSIT,
        ShipmentStatus.CANCELLED,
      ]) {
        expect(() => validateStatusTransition(ShipmentStatus.DELIVERED, next)).toThrow(
          expect.objectContaining({ statusCode: 400, code: 'ERR_SHIPMENT_INVALID_TRANSITION' })
        );
      }
    });

    it('CANCELLED → any status throws 400 (terminal state)', () => {
      for (const next of [
        ShipmentStatus.CREATED,
        ShipmentStatus.IN_TRANSIT,
        ShipmentStatus.DELIVERED,
      ]) {
        expect(() => validateStatusTransition(ShipmentStatus.CANCELLED, next)).toThrow(
          expect.objectContaining({ statusCode: 400, code: 'ERR_SHIPMENT_INVALID_TRANSITION' })
        );
      }
    });

    it('error includes allowedTransitions in details', () => {
      let caughtError: unknown;
      try {
        validateStatusTransition(ShipmentStatus.DELIVERED, ShipmentStatus.CREATED);
      } catch (e) {
        caughtError = e;
      }
      expect(caughtError).toMatchObject({
        details: { allowedTransitions: [] },
      });
    });

    it('error for CREATED → DELIVERED includes correct allowedTransitions', () => {
      let caughtError: unknown;
      try {
        validateStatusTransition(ShipmentStatus.CREATED, ShipmentStatus.DELIVERED);
      } catch (e) {
        caughtError = e;
      }
      expect(caughtError).toMatchObject({
        details: {
          allowedTransitions: expect.arrayContaining([
            ShipmentStatus.IN_TRANSIT,
            ShipmentStatus.CANCELLED,
          ]),
        },
      });
    });
  });
});
