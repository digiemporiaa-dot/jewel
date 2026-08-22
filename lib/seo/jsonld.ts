/**
 * Structured data.
 *
 * Pulled out of the page components so it can be unit-tested: a malformed
 * `Product` node does not break the page, it just silently stops producing rich
 * results, which is the kind of failure nobody notices for months.
 *
 * Two rules run through all of it:
 *
 *  - **Never publish a claim the shop has not made.** An empty address, a rating
 *    with no reviews behind it, an availability guess — Google penalises
 *    structured data that disagrees with the page, and an operator who has not
 *    filled a field has not made that claim. Every builder omits rather than
 *    invents.
 *  - **Everything is JSON, never markup.** Values are serialised with
 *    `JSON.stringify` and rendered inside a `application/ld+json` script; the
 *    escaping helper below closes the one hole that leaves.
 *
 * Pure and dependency-free.
 */

export type JsonLd = Record<string, unknown>;

/** Drop keys whose value is null, undefined, an empty string, or an empty array. */
function compact(node: JsonLd): JsonLd {
  const out: JsonLd = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Serialise for embedding in a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` escapes quotes but not `</`, so a product described as
 * `</script><script>…` would close the tag early and everything after it would
 * be parsed as HTML. Escaping the `<` closes that; the JSON value is unchanged,
 * because `<` and `<` are the same character to a JSON parser.
 */
export function serialiseJsonLd(node: JsonLd | JsonLd[]): string {
  return JSON.stringify(node)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// ── Organisation and site ────────────────────────────────────────────────────

export type OrganizationInput = {
  siteUrl: string;
  brandName: string;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  socialLinks?: string[];
};

export function organizationLd(input: OrganizationInput): JsonLd {
  // A PostalAddress with only a country in it is noise; the address is either
  // real or absent.
  const address = input.addressLine
    ? compact({
        '@type': 'PostalAddress',
        streetAddress: input.addressLine,
        addressLocality: input.city,
        addressRegion: input.state,
        postalCode: input.pincode,
        addressCountry: input.country ?? 'IN',
      })
    : null;

  return compact({
    '@type': 'Organization',
    '@id': `${input.siteUrl}#organization`,
    name: input.brandName,
    url: input.siteUrl,
    logo: input.logoUrl,
    email: input.email,
    contactPoint: input.phone
      ? [compact({ '@type': 'ContactPoint', telephone: input.phone, contactType: 'customer service', areaServed: 'IN' })]
      : null,
    address,
    sameAs: (input.socialLinks ?? []).filter(Boolean),
  });
}

export function webSiteLd(input: { siteUrl: string; brandName: string }): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': `${input.siteUrl}#website`,
    url: input.siteUrl,
    name: input.brandName,
    publisher: { '@id': `${input.siteUrl}#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${input.siteUrl}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export type OpeningHours = { days: string[]; opens: string; closes: string };

export type LocalBusinessInput = OrganizationInput & {
  businessType?: string | null;
  priceRange?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  openingHours?: unknown;
};

/**
 * LocalBusiness / JewelryStore.
 *
 * Returns null unless there is a real address to publish. A jeweller with a
 * showroom wants to appear in local results; an online-only seller does not,
 * and claiming a location they do not have is worse than claiming none — it is
 * the kind of mismatch that gets a business removed from local results
 * altogether.
 */
export function localBusinessLd(input: LocalBusinessInput): JsonLd | null {
  if (!input.addressLine?.trim()) return null;

  const org = organizationLd(input);
  const geo =
    input.latitude && input.longitude
      ? { '@type': 'GeoCoordinates', latitude: Number(input.latitude), longitude: Number(input.longitude) }
      : null;

  return compact({
    ...org,
    '@type': input.businessType?.trim() || 'JewelryStore',
    '@id': `${input.siteUrl}#localbusiness`,
    priceRange: input.priceRange,
    telephone: input.phone,
    geo,
    openingHoursSpecification: parseOpeningHours(input.openingHours),
  });
}

const DAYS = new Set([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Read opening hours out of the settings JSON column.
 *
 * Anything malformed is dropped rather than published: invalid structured data
 * is worse than none, because Google can disqualify the whole page's rich
 * results over one bad node.
 */
export function parseOpeningHours(value: unknown): JsonLd[] {
  if (!Array.isArray(value)) return [];
  const out: JsonLd[] = [];

  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const days = Array.isArray(r.days)
      ? r.days.filter((d): d is string => typeof d === 'string' && DAYS.has(d))
      : [];
    const opens = typeof r.opens === 'string' ? r.opens : '';
    const closes = typeof r.closes === 'string' ? r.closes : '';
    if (days.length === 0 || !TIME.test(opens) || !TIME.test(closes)) continue;

    out.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: days,
      opens,
      closes,
    });
  }
  return out;
}

// ── Product ──────────────────────────────────────────────────────────────────

export type ProductLdInput = {
  siteUrl: string;
  brandName: string;
  currency: string;
  path: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  images: string[];
  price?: string | null;
  inStock: boolean;
  reviewCount?: number;
  reviewAverage?: number | null;
  /** HSN-style category label, if the shop wants one published. */
  category?: string | null;
};

export function productLd(input: ProductLdInput): JsonLd {
  const url = `${input.siteUrl}${input.path}`;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    sku: input.sku,
    category: input.category,
    image: input.images.filter(Boolean),
    brand: { '@type': 'Brand', name: input.brandName },
    // Only published when reviews actually exist. A rating with nothing behind
    // it is the single most common cause of a structured-data penalty.
    aggregateRating:
      input.reviewCount && input.reviewCount > 0 && input.reviewAverage
        ? {
            '@type': 'AggregateRating',
            ratingValue: input.reviewAverage.toFixed(1),
            reviewCount: input.reviewCount,
          }
        : null,
    // Omitted entirely when there is no price. "Price on request" is a real
    // state for jewellery, and publishing a zero would be a lie.
    offers: input.price
      ? compact({
          '@type': 'Offer',
          priceCurrency: input.currency,
          price: input.price,
          availability: input.inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          url,
          seller: { '@id': `${input.siteUrl}#organization` },
        })
      : null,
  });
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

export type Crumb = { name: string; path: string };

/**
 * A breadcrumb trail.
 *
 * Positions are 1-based and contiguous, which the spec requires — a gap makes
 * Google discard the whole list. Building it from an array rather than by hand
 * per page is what keeps that true.
 */
export function breadcrumbLd(siteUrl: string, crumbs: Crumb[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${siteUrl}${crumb.path}`,
    })),
  };
}

// ── The site-wide graph ──────────────────────────────────────────────────────

/**
 * Organisation, website and (when configured) local business, as one `@graph`.
 *
 * One graph rather than three separate scripts so the `@id` references between
 * them resolve — a `seller` pointing at `#organization` only means something if
 * that node is in the same document.
 */
export function siteGraphLd(input: LocalBusinessInput & { localBusinessEnabled: boolean }): JsonLd {
  const local = input.localBusinessEnabled ? localBusinessLd(input) : null;

  return {
    '@context': 'https://schema.org',
    '@graph': [organizationLd(input), webSiteLd(input), ...(local ? [local] : [])],
  };
}
