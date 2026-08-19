import { ShipmentStatus, OrderStatus } from '@prisma/client';

/**
 * Pure mapping from a courier/Shiprocket status string to our internal
 * ShipmentStatus, plus the OrderStatus it should drive (if any). No I/O, so it's
 * unit-testable and the provider adapter and webhook both use the same rules.
 */

export type StatusMapping = { shipment: ShipmentStatus; order?: OrderStatus };

// Match on a normalised, uppercased status. Order matters: most specific first.
// NOTE: the NDR rule MUST precede the DELIVERED rule — "UNDELIVERED" contains the
// substring "DELIVERED", and mis-mapping a failed delivery to DELIVERED would
// wrongly commit stock and capture COD. `\b` guards it a second time.
const RULES: Array<{ test: RegExp; shipment: ShipmentStatus; order?: OrderStatus }> = [
  { test: /RTO.*DELIVERED|RETURN.*DELIVERED/, shipment: ShipmentStatus.RTO_DELIVERED, order: OrderStatus.RTO },
  { test: /RTO|RETURN TO ORIGIN|RETURN INITIATED/, shipment: ShipmentStatus.RTO_INITIATED, order: OrderStatus.RTO },
  { test: /NDR|UNDELIVERED|DELIVERY FAILED|EXCEPTION/, shipment: ShipmentStatus.NDR },
  { test: /\bDELIVERED\b/, shipment: ShipmentStatus.DELIVERED, order: OrderStatus.DELIVERED },
  { test: /OUT FOR DELIVERY/, shipment: ShipmentStatus.OUT_FOR_DELIVERY, order: OrderStatus.OUT_FOR_DELIVERY },
  { test: /IN[ _]?TRANSIT|SHIPPED|DISPATCH/, shipment: ShipmentStatus.IN_TRANSIT, order: OrderStatus.SHIPPED },
  { test: /PICKED[ _]?UP|PICKUP DONE|PICKUP COMPLETE/, shipment: ShipmentStatus.PICKED_UP, order: OrderStatus.SHIPPED },
  { test: /PICKUP (SCHEDULED|GENERATED|QUEUED)|MANIFEST/, shipment: ShipmentStatus.PICKUP_SCHEDULED },
  { test: /CANCEL/, shipment: ShipmentStatus.CANCELLED },
  { test: /AWB ASSIGNED|LABEL|READY TO SHIP|ORDER (CONFIRMED|CREATED)/, shipment: ShipmentStatus.PENDING },
];

export function mapShiprocketStatus(raw: string | null | undefined): StatusMapping {
  const s = (raw ?? '').toUpperCase().trim();
  for (const rule of RULES) {
    if (rule.test.test(s)) return { shipment: rule.shipment, order: rule.order };
  }
  return { shipment: ShipmentStatus.PENDING };
}

/** A shipment status is terminal — no further reconciliation polling needed. */
export function isTerminalShipmentStatus(status: ShipmentStatus): boolean {
  return (
    status === ShipmentStatus.DELIVERED ||
    status === ShipmentStatus.RTO_DELIVERED ||
    status === ShipmentStatus.CANCELLED
  );
}
