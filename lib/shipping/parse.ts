/**
 * Reading a courier's reply without trusting its shape.
 *
 * Shiprocket's AWB assignment came back nested under `response.data` in the
 * shape this client was written against, and the client destructured it
 * directly. It does not always answer that way — the nesting varies with
 * `awb_assign_status`, with shipments that already had an AWB, and between
 * courier types. When it differed, the destructure produced `undefined`, and
 * `undefined` was written to the `Shipment` row without anything noticing.
 *
 * Prisma treats an `undefined` field as "leave this column alone", so the row
 * kept its nulls and the order sat in the admin looking unshipped while a real
 * courier was on the way to collect it. The timeline, built from the same
 * values by string interpolation, recorded "AWB assigned: undefined
 * (undefined)" — the only visible trace, and only because template literals
 * are less forgiving than Prisma.
 *
 * So: look in every place the value has been seen, accept only something that
 * could plausibly be the value, and return `null` rather than a shape-shaped
 * hole when it is not there. A caller that gets `null` can refuse to write.
 *
 * Pure by design — no `server-only`, no `fetch` — so every shape below can be
 * fed to it directly in a test.
 */

/**
 * Where a payload has been seen to live, most specific first.
 *
 * The tracking envelopes are in here rather than being unwrapped at each call
 * site: the AWB recovery path reads a *tracking* reply to repair an
 * *assignment*, so the two shapes have to be legible to the same reader.
 */
const SCOPES: readonly (readonly string[])[] = [
  ['tracking_data', 'shipment_track'],
  ['data', 'shipment_track'],
  ['shipment_track'],
  ['response', 'data'],
  ['tracking_data'],
  ['data'],
  ['response'],
  [],
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strings the provider sends that mean "nothing", including the two that would
 * otherwise be rendered to staff verbatim. `"undefined"` arriving as text is
 * not hypothetical — it is what a JSON encoder upstream of us produces from the
 * same class of bug this module exists to stop.
 */
const EMPTY = new Set(['', 'null', 'undefined', 'na', 'n/a', '-', 'nil', 'none']);

/** A value worth persisting, or null. Numbers are accepted; zero is not an id. */
function usable(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !EMPTY.has(trimmed.toLowerCase()) ? trimmed : null;
}

/** Every object worth searching in this body, outermost nesting resolved. */
function scopesOf(body: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const path of SCOPES) {
    let cursor: unknown = body;
    for (const segment of path) cursor = isRecord(cursor) ? cursor[segment] : undefined;
    // Some replies wrap the single shipment in a one-element array.
    if (Array.isArray(cursor)) cursor = cursor[0];
    if (isRecord(cursor)) found.push(cursor);
  }
  return found;
}

/**
 * First usable value under any of `keys`, in any known scope.
 *
 * Scope order beats key order deliberately: a reply that nests the real answer
 * under `response.data` may also carry a stale or generic field of the same
 * name at the top level, and the nested one is the specific answer.
 */
export function readField(body: unknown, keys: readonly string[]): string | null {
  for (const scope of scopesOf(body)) {
    for (const key of keys) {
      const value = usable(scope[key]);
      if (value) return value;
    }
  }
  return null;
}

// The spellings each value has been seen under, in order of preference.
export const AWB_KEYS = ['awb_code', 'awb', 'awb_number'] as const;
export const COURIER_KEYS = ['courier_name', 'courier', 'courier_company_name'] as const;
export const LABEL_KEYS = ['label_url', 'label'] as const;
export const MANIFEST_KEYS = ['manifest_url', 'manifest'] as const;
export const SHIPMENT_ID_KEYS = ['shipment_id', 'shipmentId'] as const;
export const ORDER_ID_KEYS = ['order_id', 'orderId'] as const;
export const STATUS_KEYS = ['awb_assign_status', 'current_status', 'shipment_status', 'status'] as const;
export const PICKUP_DATE_KEYS = ['pickup_scheduled_date', 'pickup_date'] as const;
export const PICKUP_TOKEN_KEYS = ['pickup_token_number', 'pickup_token'] as const;
export const TRACK_URL_KEYS = ['track_url', 'tracking_url'] as const;
export const ETA_KEYS = ['edd', 'etd', 'expected_delivery_date'] as const;

export const readAwb = (body: unknown) => readField(body, AWB_KEYS);
export const readCourier = (body: unknown) => readField(body, COURIER_KEYS);
export const readLabelUrl = (body: unknown) => readField(body, LABEL_KEYS);
export const readManifestUrl = (body: unknown) => readField(body, MANIFEST_KEYS);
export const readShipmentId = (body: unknown) => readField(body, SHIPMENT_ID_KEYS);
export const readOrderId = (body: unknown) => readField(body, ORDER_ID_KEYS);
export const readStatus = (body: unknown) => readField(body, STATUS_KEYS);

/**
 * What the admin shows for a value the courier never gave us.
 *
 * Also scrubs the words themselves out of text written before the parsing was
 * fixed: the timeline entry for the order that exposed this bug literally reads
 * "AWB assigned: undefined (undefined)", and it is a historical record rather
 * than something to rewrite in place.
 */
export const DASH = '—';

export function display(value: unknown): string {
  return usable(value) ?? DASH;
}

export function cleanMessage(message: string): string {
  return message.replace(/\b(undefined|null)\b/g, DASH);
}
