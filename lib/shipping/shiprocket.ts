import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  ShippingProvider, ServiceabilityQuery, ServiceabilityResult, CreateShipmentInput,
  CreateShipmentResult, AwbResult, PickupResult, TrackingResult,
} from '@/lib/shipping/provider';
import { AuthBreaker, ShippingAuthError, authFailureMessage, classifyAuthFailure } from '@/lib/shipping/auth-breaker';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

/**
 * Login state lives at module scope, not on the instance.
 *
 * `getShippingProvider()` memoises one instance today, so instance fields would
 * mostly work — but "mostly" is what turned a wrong password into a locked
 * account. A second instance, constructed by a test, a script or a future
 * caller that reaches for `new ShiprocketProvider()` directly, would start with
 * an empty cache and a fresh breaker, and would happily spend the account's
 * remaining login attempts. Module scope means one token and one breaker per
 * process however many providers exist.
 */
let token: string | null = null;
let tokenExpiresAt = 0;
/** The login in flight, if any, so concurrent callers wait rather than pile on. */
let inFlight: Promise<string> | null = null;
const breaker = new AuthBreaker();

/** Refresh this far before the token actually expires, to avoid a race at the edge. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** Used when the token carries no readable expiry. Shiprocket's last ~10 days. */
const FALLBACK_TTL_MS = 6 * 60 * 60_000;

/**
 * Read `exp` out of a JWT so the cache can hold the token for as long as it is
 * genuinely valid instead of guessing an hour.
 *
 * This is not a signature check and must never be treated as one — the token is
 * ours, we just received it over TLS from the issuer, and the only decision
 * being made from this number is when to ask for a new one. A malformed or
 * absent claim falls back to a conservative fixed TTL.
 */
function tokenLifetimeMs(jwt: string, now: number): number {
  const payload = jwt.split('.')[1];
  if (!payload) return FALLBACK_TTL_MS;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return FALLBACK_TTL_MS;
    const remaining = exp * 1000 - now - EXPIRY_MARGIN_MS;
    return remaining > 0 ? remaining : FALLBACK_TTL_MS;
  } catch {
    return FALLBACK_TTL_MS;
  }
}

/** Test seam: forget the cached token and close the breaker. */
export function resetShiprocketAuth(): void {
  token = null;
  tokenExpiresAt = 0;
  inFlight = null;
  breaker.reset();
}

/**
 * Shiprocket implementation. When credentials are absent (local/dev/tests) it runs
 * in a simulated mode with deterministic responses so the full shipment lifecycle
 * is exercisable without a live account. Real mode calls the Shiprocket REST API.
 */
export class ShiprocketProvider implements ShippingProvider {
  readonly name = 'shiprocket';

  get dev(): boolean {
    return !(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
  }

  private async auth(): Promise<string> {
    const now = Date.now();
    if (token && now < tokenExpiresAt) return token;

    // Refuse before reaching for the network. The whole point of the breaker is
    // that the request itself is the damage: every attempt while the account is
    // in trouble spends one of the tries left before Shiprocket locks it.
    const state = breaker.snapshot(now);
    if (state.open) {
      throw new ShippingAuthError(
        authFailureMessage(state.kind ?? 'credentials', state.openUntil, state.detail),
        state.kind ?? 'credentials',
        state.openUntil,
      );
    }

    // One login at a time. Six admin buttons and a cron pass would otherwise be
    // six simultaneous logins, and the counter Shiprocket keeps does not care
    // that they were concurrent rather than sequential.
    inFlight ??= this.login().finally(() => { inFlight = null; });
    return inFlight;
  }

  private async login(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }),
      });
    } catch (e) {
      // Never reached their server, so no attempt was counted against us: this
      // is transient by definition and must not push the breaker open.
      const detail = e instanceof Error ? e.message : 'network error';
      breaker.recordFailure('transient', detail, Date.now());
      throw new ShippingAuthError(authFailureMessage('transient', 0, detail), 'transient', 0);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const kind = classifyAuthFailure(res.status, body);
      const now = Date.now();
      breaker.recordFailure(kind, `HTTP ${res.status}`, now);
      const after = breaker.snapshot(now);
      // Logged with the provider's own words; the message handed to staff is
      // deliberately not the raw body.
      console.error('[shiprocket] auth failed', res.status, body.slice(0, 200));
      throw new ShippingAuthError(authFailureMessage(kind, after.openUntil, `HTTP ${res.status}`), kind, after.openUntil);
    }

    const data = (await res.json()) as { token?: unknown };
    if (typeof data.token !== 'string' || data.token.length === 0) {
      // A 200 with no token is their side misbehaving, not our credentials.
      breaker.recordFailure('transient', 'login returned no token', Date.now());
      throw new ShippingAuthError(authFailureMessage('transient', 0, 'no token in response'), 'transient', 0);
    }

    const now = Date.now();
    token = data.token;
    tokenExpiresAt = now + tokenLifetimeMs(data.token, now);
    breaker.recordSuccess();
    return token;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const bearer = await this.auth();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (res.status === 401) {
      // The token went stale early. Drop it so the next call fetches a fresh
      // one — but do not retry here, or a genuinely rejected account would loop
      // straight back into the login endpoint we are trying to protect.
      token = null;
      tokenExpiresAt = 0;
    }
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
