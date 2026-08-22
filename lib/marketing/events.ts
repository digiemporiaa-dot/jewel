/**
 * E-commerce event payloads and dispatch.
 *
 * One vocabulary — GA4's — is used everywhere, and the dispatcher translates for
 * whichever tags happen to be loaded. Callers describe what the shopper did;
 * they never need to know which pixels the store has switched on.
 *
 * Client-safe: no secrets, no server imports.
 */

export type EventItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  item_category?: string;
  item_variant?: string;
};

export type EcommercePayload = {
  currency: string;
  value: number;
  items: EventItem[];
  /** Present on `purchase` only. */
  transaction_id?: string;
};

export type EcommerceEvent = 'view_item' | 'add_to_cart' | 'begin_checkout' | 'purchase';

/** GA4 event name → Meta Pixel's own vocabulary. */
const META_EVENT: Record<EcommerceEvent, string> = {
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  purchase: 'Purchase',
};

type DataLayerRecord = Record<string, unknown>;

type TagWindow = Window & {
  dataLayer?: DataLayerRecord[];
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (name: string, params?: DataLayerRecord) => void };
  pintrk?: (...args: unknown[]) => void;
  snaptr?: (...args: unknown[]) => void;
};

function tagWindow(): TagWindow | null {
  return typeof window === 'undefined' ? null : (window as TagWindow);
}

/**
 * Push an e-commerce event to every tag that is loaded.
 *
 * The `dataLayer` push happens unconditionally: the array exists before GTM
 * does, and GTM replays what it finds there on load, so an event fired early is
 * not lost. Direct pixel calls are guarded because those globals only exist when
 * the corresponding tag is actually on the page.
 *
 * `eventId` is passed through to Meta so a browser Pixel event and the matching
 * server-side CAPI event are recognised as one conversion rather than two.
 */
export function trackEcommerce(
  event: EcommerceEvent,
  payload: EcommercePayload,
  eventId?: string
): void {
  const w = tagWindow();
  if (!w) return;

  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push({ event, ecommerce: payload, ...(eventId ? { event_id: eventId } : {}) });

  // GA4 / Google Ads, when installed directly rather than through GTM.
  w.gtag?.('event', event, payload);

  w.fbq?.(
    'track',
    META_EVENT[event],
    {
      currency: payload.currency,
      value: payload.value,
      content_type: 'product',
      content_ids: payload.items.map((i) => i.item_id),
      num_items: payload.items.reduce((sum, i) => sum + i.quantity, 0),
      ...(payload.transaction_id ? { order_id: payload.transaction_id } : {}),
    },
    eventId ? { eventID: eventId } : undefined
  );

  w.ttq?.track(META_EVENT[event], { currency: payload.currency, value: payload.value });

  if (event === 'purchase') {
    w.pintrk?.('track', 'checkout', {
      value: payload.value,
      order_quantity: payload.items.reduce((sum, i) => sum + i.quantity, 0),
      currency: payload.currency,
    });
    w.snaptr?.('track', 'PURCHASE', { price: payload.value, currency: payload.currency });
  }
}

/**
 * Report a Google Ads conversion. Separate from `trackEcommerce` because it
 * needs the conversion label, and because it must fire only once per order — the
 * caller is responsible for that (see `claimPurchaseTracking`).
 */
export function trackAdsConversion(
  conversionId: string,
  label: string,
  payload: { value: number; currency: string; transaction_id: string }
): void {
  const w = tagWindow();
  w?.gtag?.('event', 'conversion', {
    send_to: `${conversionId}/${label}`,
    value: payload.value,
    currency: payload.currency,
    transaction_id: payload.transaction_id,
  });
}

/** Google Consent Mode v2 update, sent when a visitor accepts or declines. */
export function updateGoogleConsent(granted: boolean): void {
  const w = tagWindow();
  const value = granted ? 'granted' : 'denied';
  w?.gtag?.('consent', 'update', {
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
    analytics_storage: value,
  });
}

/**
 * Report an enquiry — someone opening a WhatsApp chat with the shop.
 *
 * Not part of `trackEcommerce` because it is not a step in the purchase funnel
 * and carries no money: quoting a value here would inflate ROAS with enquiries
 * that never became sales. Each network has its own name for the same idea.
 */
export function trackLead(params: { productId?: string | null } = {}): void {
  const w = tagWindow();
  if (!w) return;
  const detail = params.productId ? { product_id: params.productId } : {};

  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push({ event: 'generate_lead', ...detail });

  w.gtag?.('event', 'generate_lead', detail);
  w.fbq?.('track', 'Lead', detail);
  w.ttq?.track('Contact', detail);
  w.pintrk?.('track', 'lead', detail);
  // Snapchat has no enquiry event; SIGN_UP is the closest standard one.
  w.snaptr?.('track', 'SIGN_UP', detail);
}
