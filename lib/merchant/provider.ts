import 'server-only';

/**
 * Pushing the catalogue to a shopping channel.
 *
 * Google is the first implementation and the reason this exists, but the shape
 * is deliberately not Google's: the same catalogue goes to Facebook and to a
 * marketplace feed sooner or later, and a provider interface is what keeps the
 * mapping in one file instead of three.
 *
 * Why a push at all, when Merchant Center will happily crawl a feed: gold moves
 * every day. A crawl is discovered on Google's schedule, which is days, and for
 * those days the Shopping ad quotes one price and the product page quotes
 * another. On a ₹80,000 necklace that gap is not a rounding error — it is the
 * customer deciding the shop cannot be trusted, and Google eventually
 * disapproving the item for price mismatch.
 */

/** One item, already flattened out of Prisma and ready to map. */
export type MerchantProduct = {
  /** Our SKU. Stable, unique, and what Google keys the offer on. */
  offerId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string | null;
  additionalImageLinks?: string[];
  availability: 'in stock' | 'out of stock';
  /** Rupees, two decimals, as a string — never a float. */
  price: string;
  currency: string;
  brand: string;
  /** Gold, Silver. */
  material: string | null;
  /** Yellow, White, Rose. */
  color: string | null;
  /**
   * Optional, and currently never set.
   *
   * `Product` has no target-audience column, and Google treats `gender` as
   * optional for jewellery. Guessing it from a category name would put a claim
   * on the listing the shop never made, so it stays absent until there is a
   * field behind it.
   */
  gender?: 'male' | 'female' | 'unisex';
  /** 22K, 18K, 925 Silver. */
  purity: string | null;
  category: string;
};

export type BatchResult = {
  /** Items Google accepted. */
  succeeded: number;
  /** Items Google rejected, with its reason. */
  failed: Array<{ offerId: string; error: string }>;
  /** True when nothing was sent because the channel is not configured. */
  skipped: boolean;
};

export interface MerchantProvider {
  readonly name: string;
  /**
   * No credentials, so nothing leaves the process.
   *
   * The same idea as `ShiprocketProvider.dev`: a shop deployed without a
   * Merchant Center account must run normally, and a cron that fails because an
   * optional integration is unconfigured is a cron that stops doing its actual
   * job — which here is repricing the catalogue.
   */
  readonly dev: boolean;
  upsertProduct(product: MerchantProduct): Promise<void>;
  deleteProduct(offerId: string): Promise<void>;
  batchUpsert(products: MerchantProduct[]): Promise<BatchResult>;
}

/** Content API's ceiling for one `products.custombatch` call. */
export const BATCH_SIZE = 100;

/**
 * "Apparel & Accessories > Jewelry", category 188 in Google's taxonomy.
 *
 * Sent as the numeric id rather than the path string: the path wording changes
 * between taxonomy revisions and the id does not.
 */
export const JEWELLERY_CATEGORY_ID = '188';

export function chunk<T>(items: readonly T[], size: number = BATCH_SIZE): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
