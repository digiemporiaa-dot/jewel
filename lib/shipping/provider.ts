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

export type CreateShipmentResult = { providerOrderId: string; providerShipmentId: string };
export type AwbResult = { awb: string; courier: string; labelUrl?: string | null };
export type PickupResult = { pickupScheduledAt: Date; pickupToken?: string | null };
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
