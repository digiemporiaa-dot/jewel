/**
 * De-duplication keys for automatically captured leads.
 *
 * A shopper who taps "Enquire" four times while comparing two necklaces must not
 * produce four leads — a CRM full of noise gets ignored, and an ignored CRM is
 * worse than no CRM. But the repeats are not thrown away either: four enquiries
 * on one piece is a warmer lead than one, so the count is kept on the lead.
 *
 * The key is what Postgres enforces uniqueness on, so the guarantee does not
 * depend on application logic winning a race between two concurrent clicks.
 *
 * Pure and dependency-free, so the bucketing rules are unit-testable.
 */

/** Identity we can attribute an enquiry to, best first. */
export type EnquiryIdentity =
  | { kind: 'customer'; id: string }
  | { kind: 'session'; token: string };

/**
 * Day bucket in IST.
 *
 * The shop, its customers and its staff are all in one timezone, so "today"
 * must mean today in Delhi. Bucketing on UTC would split an evening's browsing
 * across two days at 5:30pm local, which is exactly when people shop.
 */
export function istDayKey(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/**
 * One lead per shopper, per piece, per day.
 *
 * A day is a rule the shop owner can hold in their head — "if they enquired
 * again tomorrow, that is a new lead" — which matters more than a cleverer
 * sliding window they would have to reason about.
 */
export function whatsappDedupeKey(params: {
  identity: EnquiryIdentity;
  productId: string | null;
  at: Date;
}): string {
  const who = params.identity.kind === 'customer'
    ? `c:${params.identity.id}`
    : `s:${params.identity.token}`;
  // The site-wide chat button is not about a piece, so it gets its own slot
  // rather than colliding with whichever product page it was clicked from.
  const what = params.productId ?? 'site';
  return `whatsapp:${who}:${what}:${istDayKey(params.at)}`;
}

/**
 * One lead per abandoned cart, ever.
 *
 * Not per day: the reminder campaign already runs on a schedule, and a second
 * lead for the same cart would have sales chasing one shopper twice.
 */
export function cartDedupeKey(cartId: string): string {
  return `cart:${cartId}`;
}

/** The note stored on an auto-captured WhatsApp lead. */
export function whatsappNote(productName: string | null): string {
  return productName
    ? `Tapped Enquire on WhatsApp for ${productName}.`
    : 'Started a WhatsApp chat from the site.';
}

/** The note stored on an abandoned-cart lead. */
export function abandonedCartNote(itemCount: number, value: string | null): string {
  const items = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
  return value
    ? `Left ${items} worth ${value} in the bag.`
    : `Left ${items} in the bag.`;
}
