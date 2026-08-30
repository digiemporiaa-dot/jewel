import 'server-only';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';
import { siteUrl } from '@/lib/seo/settings';
import type { MerchantProduct } from '@/lib/merchant/provider';

/**
 * The catalogue, as a shopping channel needs to see it.
 *
 * One reader for the Content API push and the XML feed both, because two
 * readers is how the feed and the API start advertising different prices for
 * the same piece — which is the exact failure this feature exists to prevent.
 */

/** What a listing needs before it is worth sending. */
export type Skipped = { sku: string; reason: string };

export async function catalogueForMerchant(): Promise<{ items: MerchantProduct[]; skipped: Skipped[] }> {
  const [store, products] = await Promise.all([
    getStoreSettings(),
    prisma.product.findMany({
      // `noIndex` is honoured here too. A product the shop has told search
      // engines to ignore should not reappear as a paid Shopping listing.
      where: { isActive: true, deletedAt: null, publishedAt: { not: null }, noIndex: false },
      select: {
        sku: true, name: true, slug: true, shortDescription: true, description: true,
        priceFrom: true, metalColor: true,
        category: { select: { name: true } },
        metal: { select: { name: true } },
        purity: { select: { name: true } },
        images: { where: { type: 'IMAGE' }, orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }], select: { url: true }, take: 10 },
        variants: {
          where: { isActive: true },
          select: { inventory: { select: { stockQty: true, reservedQty: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const base = siteUrl().replace(/\/$/, '');
  const items: MerchantProduct[] = [];
  const skipped: Skipped[] = [];

  /**
   * Absolute, always.
   *
   * Image URLs in this database are a mix: uploads to R2 come back absolute,
   * and seeded or hand-entered ones are site-relative (`/products/ring.jpg`).
   * A relative path renders correctly on our own pages and is rejected by
   * Google for every item that carries one — the feed is fetched from outside,
   * where `/products/ring.jpg` means nothing. Caught by reading a real feed,
   * not by any test that used a fixture.
   */
  const absolute = (url: string): string | null => {
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  };

  for (const p of products) {
    // A listing with no price is rejected by Google and, worse, a listing with
    // a *wrong* price gets the item suspended. `priceFrom` is null until the
    // reprice job has run over it, so this is a real state rather than a
    // defensive nicety.
    if (p.priceFrom === null) {
      skipped.push({ sku: p.sku, reason: 'no computed price yet — run the reprice job' });
      continue;
    }
    const image = p.images[0] ? absolute(p.images[0].url) : null;
    if (!image) {
      // Google requires an image. Sending the item without one earns a
      // disapproval rather than a listing.
      skipped.push({ sku: p.sku, reason: 'no image' });
      continue;
    }

    // Available across every active variant. A piece with one variant in stock
    // is in stock; reserved units belong to somebody else's cart already.
    const available = p.variants.reduce(
      (sum, v) => sum + Math.max(0, (v.inventory?.stockQty ?? 0) - (v.inventory?.reservedQty ?? 0)),
      0
    );

    items.push({
      offerId: p.sku,
      title: p.name,
      description: p.shortDescription ?? p.description ?? p.name,
      link: `${base}/p/${p.slug}`,
      imageLink: image,
      additionalImageLinks: p.images.slice(1, 10).map((i) => absolute(i.url)).filter((u): u is string => u !== null),
      availability: available > 0 ? 'in stock' : 'out of stock',
      price: p.priceFrom.toString(),
      currency: store.currency,
      brand: store.brandName,
      material: p.metal?.name ?? null,
      color: p.metalColor,
      purity: p.purity?.name ?? null,
      category: p.category.name,
    });
  }

  return { items, skipped };
}
