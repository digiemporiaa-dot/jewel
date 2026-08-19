import { describe, it, expect } from 'vitest';
import { ShipmentStatus, OrderStatus } from '@prisma/client';
import { mapShiprocketStatus, isTerminalShipmentStatus } from '@/lib/shipping/status';

describe('Shiprocket status mapping', () => {
  it('maps delivery states and drives the order status', () => {
    expect(mapShiprocketStatus('DELIVERED')).toEqual({ shipment: ShipmentStatus.DELIVERED, order: OrderStatus.DELIVERED });
    expect(mapShiprocketStatus('Out For Delivery')).toEqual({ shipment: ShipmentStatus.OUT_FOR_DELIVERY, order: OrderStatus.OUT_FOR_DELIVERY });
    expect(mapShiprocketStatus('IN TRANSIT')).toEqual({ shipment: ShipmentStatus.IN_TRANSIT, order: OrderStatus.SHIPPED });
    expect(mapShiprocketStatus('Picked Up')).toEqual({ shipment: ShipmentStatus.PICKED_UP, order: OrderStatus.SHIPPED });
  });

  it('maps pickup and manifest states without moving the order', () => {
    expect(mapShiprocketStatus('PICKUP SCHEDULED')).toEqual({ shipment: ShipmentStatus.PICKUP_SCHEDULED });
    expect(mapShiprocketStatus('MANIFEST GENERATED')).toEqual({ shipment: ShipmentStatus.PICKUP_SCHEDULED });
  });

  it('maps NDR / undelivered exceptions', () => {
    expect(mapShiprocketStatus('UNDELIVERED')).toEqual({ shipment: ShipmentStatus.NDR });
    expect(mapShiprocketStatus('NDR raised')).toEqual({ shipment: ShipmentStatus.NDR });
    expect(mapShiprocketStatus('Delivery Failed')).toEqual({ shipment: ShipmentStatus.NDR });
  });

  it('never treats UNDELIVERED as DELIVERED (would wrongly commit stock / capture COD)', () => {
    const undelivered = mapShiprocketStatus('UNDELIVERED');
    expect(undelivered.shipment).not.toBe(ShipmentStatus.DELIVERED);
    expect(undelivered.order).toBeUndefined();
  });

  it('distinguishes RTO initiated vs delivered', () => {
    expect(mapShiprocketStatus('RTO Initiated')).toEqual({ shipment: ShipmentStatus.RTO_INITIATED, order: OrderStatus.RTO });
    expect(mapShiprocketStatus('RTO DELIVERED')).toEqual({ shipment: ShipmentStatus.RTO_DELIVERED, order: OrderStatus.RTO });
  });

  it('falls back to PENDING for unknown statuses', () => {
    expect(mapShiprocketStatus('SOMETHING NEW')).toEqual({ shipment: ShipmentStatus.PENDING });
    expect(mapShiprocketStatus(undefined)).toEqual({ shipment: ShipmentStatus.PENDING });
  });

  it('identifies terminal statuses for reconciliation', () => {
    expect(isTerminalShipmentStatus(ShipmentStatus.DELIVERED)).toBe(true);
    expect(isTerminalShipmentStatus(ShipmentStatus.RTO_DELIVERED)).toBe(true);
    expect(isTerminalShipmentStatus(ShipmentStatus.IN_TRANSIT)).toBe(false);
    expect(isTerminalShipmentStatus(ShipmentStatus.NDR)).toBe(false);
  });
});
