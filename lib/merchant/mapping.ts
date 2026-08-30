import { JEWELLERY_CATEGORY_ID, type MerchantProduct } from '@/lib/merchant/provider';

/**
 * Our product, in Google's words.
 *
 * Pure and free of `server-only`, because this is the part that has to be
 * exactly right and the part nothing else will catch. A wrong price format is
 * not a crash — Google accepts the item and disapproves it hours later in a
 * dashboard nobody is watching, and the listing quietly stops appearing.
 */

/** The Content API resource, as far as this application fills it in. */
export type GoogleProduct = {
  offerId: string;
  title: string;
  description: string;
  link: string;
  imageLink?: string;
  additionalImageLinks?: string[];
  contentLanguage: string;
  targetCountry: string;
  channel: 'online';
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  price: { value: string; currency: string };
  brand: string;
  googleProductCategory: string;
  productTypes?: string[];
  material?: string;
  color?: string;
  gender?: string;
  customLabel0?: string;
  customLabel1?: string;
  /**
   * Jewellery has no GTIN or MPN.
   *
   * Without this flag Google warns on every item for a missing identifier and
   * eventually limits the listing. Saying so once is the supported answer.
   */
  identifierExists: false;
};

/**
 * Strip markup, keeping the words.
 *
 * The short description is operator-written and may carry formatting from a
 * rich-text field. Google's `description` is plain text: tags arrive as
 * literal `<p>` on the customer's screen in a Shopping card.
 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    // Whole elements whose *content* is not prose, before the general strip.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // A block boundary is a word boundary: "one</p><p>two" is two sentences,
    // not "onetwo".
    .replace(/<\/(p|div|li|h[1-6]|tr|br)\s*\/?>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Google's caps. Truncated on a word boundary rather than mid-word. */
const TITLE_MAX = 150;
const DESCRIPTION_MAX = 5000;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * Rupees as Google wants them: a decimal string with exactly two places.
 *
 * Never a number. `19999.9` serialises as `19999.9` and Google reads a price
 * ten paise short of the one on the page — enough for it to flag a mismatch
 * against the crawled landing page and suspend the item.
 */
export function formatPrice(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export function toGoogleProduct(
  product: MerchantProduct,
  options: { language?: string; country?: string } = {}
): GoogleProduct {
  const mapped: GoogleProduct = {
    offerId: product.offerId,
    title: truncate(stripHtml(product.title), TITLE_MAX),
    description: truncate(stripHtml(product.description), DESCRIPTION_MAX),
    link: product.link,
    contentLanguage: options.language ?? 'en',
    targetCountry: options.country ?? 'IN',
    channel: 'online',
    availability: product.availability,
    condition: 'new',
    price: { value: formatPrice(product.price), currency: product.currency },
    brand: product.brand,
    googleProductCategory: JEWELLERY_CATEGORY_ID,
    identifierExists: false,
  };

  // Optional fields are omitted rather than sent empty. Google treats `""` as a
  // supplied value and will warn about an item whose colour is blank, where an
  // absent field is simply not known.
  if (product.imageLink) mapped.imageLink = product.imageLink;
  if (product.additionalImageLinks?.length) mapped.additionalImageLinks = product.additionalImageLinks;
  if (product.material) mapped.material = product.material;
  if (product.color) mapped.color = product.color;
  if (product.gender) mapped.gender = product.gender;
  // customLabel0/1 are the shop's own segmentation inside Shopping campaigns:
  // bidding on 22K separately from 925 silver is the whole reason they exist.
  if (product.purity) mapped.customLabel0 = product.purity;
  if (product.category) {
    mapped.customLabel1 = product.category;
    mapped.productTypes = [product.category];
  }
  return mapped;
}
