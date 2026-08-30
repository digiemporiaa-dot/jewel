import { JEWELLERY_CATEGORY_ID, type MerchantProduct } from '@/lib/merchant/provider';
import { stripHtml, truncate, formatPrice } from '@/lib/merchant/mapping';

/**
 * The same catalogue as an RSS 2.0 feed, in Google's `g:` namespace.
 *
 * A supplemental feed for the setup window: Merchant Center wants *something*
 * to look at before an API link exists, and it is also the answer when the
 * service account stops working and nobody notices for a week. It is the
 * fallback, not the mechanism — a crawl happens on Google's schedule, which is
 * exactly the delay the Content API push exists to remove.
 *
 * Built from `catalogueForMerchant()` like the API path, so the two cannot
 * advertise different prices for the same piece.
 *
 * Pure, so the escaping can be tested directly.
 */

/**
 * XML escaping, on every value without exception.
 *
 * Product names carry `&` constantly — "Ruby & Gold", "Rani Haar & Earrings" —
 * and a bare ampersand does not make the feed *wrong*, it makes it unparseable.
 * Google rejects the whole file, so one product name breaks every listing.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal in XML 1.0 at all, escaped or otherwise,
    // and one pasted in from a word processor takes the whole file down with it.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function tag(name: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `    <${name}>${escapeXml(value)}</${name}>\n`;
}

export function buildGoogleShoppingFeed(
  items: readonly MerchantProduct[],
  meta: { title: string; link: string; description: string }
): string {
  const entries = items
    .map((p) => {
      let out = '  <item>\n';
      out += tag('g:id', p.offerId);
      out += tag('title', truncate(stripHtml(p.title), 150));
      out += tag('description', truncate(stripHtml(p.description), 5000));
      out += tag('link', p.link);
      out += tag('g:image_link', p.imageLink);
      for (const extra of p.additionalImageLinks ?? []) out += tag('g:additional_image_link', extra);
      out += tag('g:availability', p.availability);
      out += tag('g:price', `${formatPrice(p.price)} ${p.currency}`);
      out += tag('g:brand', p.brand);
      out += tag('g:condition', 'new');
      out += tag('g:google_product_category', JEWELLERY_CATEGORY_ID);
      out += tag('g:product_type', p.category);
      out += tag('g:material', p.material);
      out += tag('g:color', p.color);
      out += tag('g:gender', p.gender);
      out += tag('g:custom_label_0', p.purity);
      out += tag('g:custom_label_1', p.category);
      // Jewellery has no GTIN or MPN; saying so stops the warning on every item.
      out += tag('g:identifier_exists', 'no');
      out += '  </item>\n';
      return out;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    '<channel>\n' +
    tag('title', meta.title) +
    tag('link', meta.link) +
    tag('description', meta.description) +
    entries +
    '</channel>\n' +
    '</rss>\n'
  );
}
