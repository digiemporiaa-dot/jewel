import 'server-only';

/**
 * Shipping provider abstraction (brief §21). Shiprocket is the first implementation
 * but the interface allows a future courier aggregator to replace it without
 * touching the shipment service, admin UI or webhooks.
 */

export type ServiceabilityQuery = {
  pickupPincode: string;
  deliveryPincode: string;
  weightKg: number;
  cod: boolean;
  declaredValue: number;
};

export type CourierOption = {
  id: string;
  name: string;
  rate: number;
  etaDays: number | null;
  cod: boolean;
};

export type ServiceabilityResult = {
  serviceable: boolean;
  couriers: CourierOption[];
  recommended?: CourierOption;
};

export type CreateShipmentInput = {
  orderNumber: string;
  cod: boolean;
  subtotal: number;
  weightKg: number;
  contact: { name: string; phone: string; email?: string | null };
  address: { line1: string; line2?: string; city: string; state: string; pincode: string; country?: string };
  items: Array<{ name: string; sku: string; quantity: number; unitPrice: number }>;
};

/**
 * Every field a courier might not send back is nullable here on purpose.
 *
 * These were typed as required strings, which told TypeScript the values were
 * always present and let a mis-parsed reply be written to the database as
 * `undefined` with nothing complaining. Nullable types push the question back
 * to the caller: it now has to decide what to do when the courier did not
 * answer, and the compiler will not let it skip that.
 */
export type CreateShipmentResult = { providerOrderId: string | null; providerShipmentId: string | null };
export type AwbResult = { awb: string | null; courier: string | null; labelUrl?: string | null; rawStatus?: string | null };
export type PickupResult = { pickupScheduledAt: Date | null; pickupToken?: string | null };

/**
 * The courier's current view of a shipment, read back rather than assumed.
 *
 * This is the repair path: when an assignment succeeded at their end but we
 * failed to record it, this re-reads the AWB and status from the shipment we
 * already created, so the row can be fixed without booking a second shipment
 * against the same order.
 */
export type ShipmentSnapshot = {
  awb: string | null;
  courier: string | null;
  rawStatus: string | null;
  labelUrl: string | null;
  trackingUrl: string | null;
};
export type TrackingCheckpoint = { at: string; status: string; location?: string | null };
export type TrackingResult = {
  rawStatus: string;
  awb: string | null;
  courier: string | null;
  trackingUrl: string | null;
  etaDate: string | null;
  checkpoints: TrackingCheckpoint[];
};

export interface ShippingProvider {
  readonly name: string;
  readonly dev: boolean;
  checkServiceability(q: ServiceabilityQuery): Promise<ServiceabilityResult>;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  assignAwb(providerShipmentId: string, courierId?: string): Promise<AwbResult>;
  /** Re-read what the courier holds for this shipment. Used to repair a mis-parse. */
  getShipment(providerShipmentId: string): Promise<ShipmentSnapshot>;
  schedulePickup(providerShipmentId: string): Promise<PickupResult>;
  generateLabel(providerShipmentId: string): Promise<{ labelUrl: string }>;
  generateManifest(providerShipmentIds: string[]): Promise<{ manifestUrl: string }>;
  track(awb: string): Promise<TrackingResult>;
  cancelShipment(providerShipmentId: string): Promise<void>;
}

let cached: ShippingProvider | null = null;

/** Return the configured shipping provider (Shiprocket). Memoised per process. */
export async function getShippingProvider(): Promise<ShippingProvider> {
  if (cached) return cached;
  const { ShiprocketProvider } = await import('@/lib/shipping/shiprocket');
  cached = new ShiprocketProvider();
  return cached;
}
