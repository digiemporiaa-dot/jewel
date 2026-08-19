import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  ShippingProvider, ServiceabilityQuery, ServiceabilityResult, CreateShipmentInput,
  CreateShipmentResult, AwbResult, PickupResult, TrackingResult,
} from '@/lib/shipping/provider';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

/**
 * Shiprocket implementation. When credentials are absent (local/dev/tests) it runs
 * in a simulated mode with deterministic responses so the full shipment lifecycle
 * is exercisable without a live account. Real mode calls the Shiprocket REST API.
 */
export class ShiprocketProvider implements ShippingProvider {
  readonly name = 'shiprocket';
  private token: string | null = null;
  private tokenAt = 0;

  get dev(): boolean {
    return !(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
  }

  private async auth(): Promise<string> {
    // Token is valid ~10 days; refresh hourly to be safe.
    if (this.token && Date.now() - this.tokenAt < 60 * 60_000) return this.token;
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Shiprocket auth failed: ${res.status}`);
    const data = (await res.json()) as { token: string };
    this.token = data.token;
    this.tokenAt = Date.now();
    return this.token;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.auth();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Shiprocket ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async checkServiceability(q: ServiceabilityQuery): Promise<ServiceabilityResult> {
    if (this.dev) {
      const eta = Number(q.deliveryPincode[0]) <= 4 ? 3 : 6;
      const couriers = [
        { id: 'sim-express', name: 'Maya Express (sim)', rate: 90, etaDays: eta, cod: q.cod },
        { id: 'sim-surface', name: 'Surface (sim)', rate: 60, etaDays: eta + 2, cod: q.cod },
      ];
      return { serviceable: true, couriers, recommended: couriers[0] };
    }
    const params = new URLSearchParams({
      pickup_postcode: process.env.SHIPROCKET_PICKUP_PINCODE ?? '110005',
      delivery_postcode: q.deliveryPincode,
      weight: String(q.weightKg),
      cod: q.cod ? '1' : '0',
      declared_value: String(q.declaredValue),
    });
    const data = await this.api<{ data: { available_courier_companies?: Array<{ courier_company_id: number; courier_name: string; rate: number; estimated_delivery_days: string; cod: number }> } }>(`/courier/serviceability/?${params}`);
    const list = data.data?.available_courier_companies ?? [];
    const couriers = list.map((c) => ({ id: String(c.courier_company_id), name: c.courier_name, rate: c.rate, etaDays: Number(c.estimated_delivery_days) || null, cod: c.cod === 1 }));
    return { serviceable: couriers.length > 0, couriers, recommended: couriers[0] };
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    if (this.dev) {
      return { providerOrderId: `sr_ord_${shortId()}`, providerShipmentId: `sr_shp_${shortId()}` };
    }
    const [firstName, ...rest] = input.contact.name.split(' ');
    const data = await this.api<{ order_id: number; shipment_id: number }>(`/orders/create/adhoc`, {
      method: 'POST',
      body: JSON.stringify({
        order_id: input.orderNumber,
        order_date: new Date().toISOString().slice(0, 10),
        pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION ?? 'Primary',
        billing_customer_name: firstName,
        billing_last_name: rest.join(' ') || '.',
        billing_address: input.address.line1,
        billing_address_2: input.address.line2 ?? '',
        billing_city: input.address.city,
        billing_pincode: input.address.pincode,
        billing_state: input.address.state,
        billing_country: input.address.country ?? 'India',
        billing_email: input.contact.email ?? 'orders@example.com',
        billing_phone: input.contact.phone,
        shipping_is_billing: true,
        order_items: input.items.map((i) => ({ name: i.name, sku: i.sku, units: i.quantity, selling_price: i.unitPrice })),
        payment_method: input.cod ? 'COD' : 'Prepaid',
        sub_total: input.subtotal,
        length: 10, breadth: 10, height: 5, weight: input.weightKg,
      }),
    });
    return { providerOrderId: String(data.order_id), providerShipmentId: String(data.shipment_id) };
  }

  async assignAwb(providerShipmentId: string, courierId?: string): Promise<AwbResult> {
    if (this.dev) {
      return { awb: `SIMAWB${shortId().toUpperCase()}`, courier: 'Maya Express (sim)', labelUrl: null };
    }
    const data = await this.api<{ response: { data: { awb_code: string; courier_name: string } } }>(`/courier/assign/awb`, {
      method: 'POST',
      body: JSON.stringify({ shipment_id: Number(providerShipmentId), ...(courierId ? { courier_id: Number(courierId) } : {}) }),
    });
    return { awb: data.response.data.awb_code, courier: data.response.data.courier_name };
  }

  async schedulePickup(providerShipmentId: string): Promise<PickupResult> {
    if (this.dev) return { pickupScheduledAt: new Date(Date.now() + 24 * 3600_000), pickupToken: `sim_pk_${shortId()}` };
    const data = await this.api<{ pickup_scheduled_date?: string; pickup_token_number?: string }>(`/courier/generate/pickup`, {
      method: 'POST',
      body: JSON.stringify({ shipment_id: [Number(providerShipmentId)] }),
    });
    return { pickupScheduledAt: data.pickup_scheduled_date ? new Date(data.pickup_scheduled_date) : new Date(), pickupToken: data.pickup_token_number ?? null };
  }

  async generateLabel(providerShipmentId: string): Promise<{ labelUrl: string }> {
    if (this.dev) return { labelUrl: `https://example.com/labels/${providerShipmentId}.pdf` };
    const data = await this.api<{ label_url: string }>(`/courier/generate/label`, { method: 'POST', body: JSON.stringify({ shipment_id: [Number(providerShipmentId)] }) });
    return { labelUrl: data.label_url };
  }

  async generateManifest(providerShipmentIds: string[]): Promise<{ manifestUrl: string }> {
    if (this.dev) return { manifestUrl: `https://example.com/manifests/${shortId()}.pdf` };
    const data = await this.api<{ manifest_url: string }>(`/manifests/generate`, { method: 'POST', body: JSON.stringify({ shipment_id: providerShipmentIds.map(Number) }) });
    return { manifestUrl: data.manifest_url };
  }

  async track(awb: string): Promise<TrackingResult> {
    if (this.dev) {
      return { rawStatus: 'IN TRANSIT', awb, courier: 'Maya Express (sim)', trackingUrl: `https://example.com/track/${awb}`, etaDate: null, checkpoints: [{ at: new Date().toISOString(), status: 'In Transit', location: 'Hub' }] };
    }
    const data = await this.api<{ tracking_data: { shipment_track?: Array<{ current_status: string; courier_name: string; awb_code: string; edd: string }>; shipment_track_activities?: Array<{ date: string; activity: string; location: string }>; track_url?: string } }>(`/courier/track/awb/${awb}`);
    const t = data.tracking_data;
    const head = t.shipment_track?.[0];
    return {
      rawStatus: head?.current_status ?? 'UNKNOWN',
      awb: head?.awb_code ?? awb,
      courier: head?.courier_name ?? null,
      trackingUrl: t.track_url ?? null,
      etaDate: head?.edd ?? null,
      checkpoints: (t.shipment_track_activities ?? []).map((a) => ({ at: a.date, status: a.activity, location: a.location })),
    };
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    if (this.dev) return;
    await this.api(`/orders/cancel/shipment/awbs`, { method: 'POST', body: JSON.stringify({ awbs: [providerShipmentId] }) });
  }
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}
