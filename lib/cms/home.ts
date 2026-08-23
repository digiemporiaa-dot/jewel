import type { CmsBlockType } from '@prisma/client';
import type { StoredBlockStyle } from '@/lib/cms/style';

/**
 * The homepage, as content.
 *
 * The busiest page on the site used to be a hardcoded React component: an
 * operator who wanted to swap the hero picture or reword the headline had to ask
 * a developer. For a build that gets redeployed for other jewellers that is the
 * wrong shape entirely — the design is the template, the words and pictures are
 * the shop's.
 *
 * So the homepage is a CMS page like any other, reserved at the slug below, and
 * this file holds the blueprint it starts from. Two consequences worth knowing:
 *
 *  - **The blueprint is also the fallback.** A shop that has never opened the CMS
 *    still gets this exact page, rendered from the blueprint in memory. There is
 *    one homepage design, not a hardcoded one and a CMS one that drift apart.
 *  - **It is a starting point, not a lock.** "Set up homepage" in the admin
 *    materialises these blocks as ordinary editable rows. From then on the
 *    database wins and this file is never consulted again.
 */

/** Reserved slug. A CmsPage with this slug *is* the homepage. */
export const HOME_SLUG = 'home';

export function isHomeSlug(slug: string): boolean {
  return slug === HOME_SLUG;
}

/**
 * Where a CMS page lives on the storefront. The homepage is at `/`, not at
 * `/pages/home` — two addresses for one page is duplicate content, and the
 * `/pages/home` route redirects here for that reason.
 */
export function storefrontPathForPage(slug: string): string {
  return isHomeSlug(slug) ? '/' : `/pages/${slug}`;
}

/** What to call a page in admin lists, so the homepage is obvious at a glance. */
export function pageKindLabel(slug: string): string | null {
  return isHomeSlug(slug) ? 'Homepage' : null;
}

export type BlueprintBlock = {
  type: CmsBlockType;
  data: Record<string, unknown> & { style?: StoredBlockStyle };
};

export const HOME_PAGE_TITLE = 'Homepage';

/**
 * The default homepage. Copy is deliberately generic-but-finished: a jeweller
 * reading it should recognise their own shop in it and only need to change nouns.
 * Every value here passes the same schema an operator's edit does — `tests/
 * cms-home.test.ts` asserts that, so a schema change can never leave a fresh
 * install with a homepage that refuses to render.
 */
export const HOME_BLUEPRINT: readonly BlueprintBlock[] = [
  {
    type: 'HERO',
    data: {
      eyebrow: 'The Bridal Edit',
      heading: 'Heirloom gold, reimagined for today.',
      subheading:
        "Hallmarked gold, certified diamonds and handcrafted silver — priced transparently against today's live metal rates.",
      imageUrl: '',
      mobileImageUrl: '',
      imageAlt: '',
      ctaLabel: 'Shop New Arrivals',
      ctaHref: '/c/new-arrivals',
      ctaLabel2: 'Book a Showroom Visit',
      ctaHref2: '/appointments',
      style: { background: 'paper-2', spacing: 'roomy', align: 'left', width: 'contained' },
    },
  },
  {
    type: 'CATEGORY_GRID',
    data: {
      eyebrow: 'Explore',
      heading: 'Shop by Category',
      limit: 8,
      viewAllHref: '/collections',
      style: { background: 'none', spacing: 'roomy', align: 'left', width: 'contained', columns: 4 },
    },
  },
  {
    type: 'PRODUCT_GRID',
    data: {
      eyebrow: 'Just in',
      heading: 'New Arrivals',
      source: 'new',
      limit: 8,
      viewAllHref: '/c/new-arrivals',
      style: { background: 'none', spacing: 'normal', width: 'contained' },
    },
  },
  {
    type: 'PRODUCT_GRID',
    data: {
      eyebrow: 'Handpicked',
      heading: 'Featured Pieces',
      source: 'featured',
      limit: 8,
      viewAllHref: '/collections',
      style: { background: 'none', spacing: 'normal', width: 'contained' },
    },
  },
  {
    type: 'IMAGE_TEXT',
    data: {
      heading: 'Transparent pricing, honest craftsmanship',
      body:
        "Every dynamic price is calculated live from the day's metal rate, weight, wastage, making charges and GST — the same breakup we show you on every product.",
      imageUrl: '',
      imageAlt: '',
      imagePosition: 'left',
      ctaLabel: 'Our Craft',
      ctaHref: '/pages/about',
      style: { background: 'velvet', spacing: 'roomy', width: 'contained', mediaSide: 'left' },
    },
  },
  {
    type: 'PRODUCT_GRID',
    data: {
      eyebrow: 'Loved by customers',
      heading: 'Best Sellers',
      source: 'bestsellers',
      limit: 8,
      viewAllHref: '/c/new-arrivals?sort=best-selling',
      style: { background: 'none', spacing: 'normal', width: 'contained' },
    },
  },
  {
    type: 'COLLECTION_GRID',
    data: {
      heading: 'Featured Collections',
      limit: 3,
      style: { background: 'none', spacing: 'roomy', align: 'left', width: 'contained', columns: 3 },
    },
  },
  {
    type: 'TRUST_ROW',
    data: {
      items: [
        { title: 'BIS Hallmarked', subtitle: 'Certified purity on every gold piece' },
        { title: 'Certified Diamonds', subtitle: 'IGI / GIA graded stones' },
        { title: 'Live Rate Pricing', subtitle: "Priced on today's metal rate" },
        { title: 'Pan-India Delivery', subtitle: 'Insured & fully tracked' },
      ],
      style: { background: 'none', spacing: 'compact', align: 'center', width: 'contained', columns: 4 },
    },
  },
];
