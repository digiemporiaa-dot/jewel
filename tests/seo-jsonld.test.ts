import { describe, it, expect } from 'vitest';
import {
  organizationLd, webSiteLd, localBusinessLd, productLd, breadcrumbLd,
  siteGraphLd, parseOpeningHours, serialiseJsonLd,
} from '@/lib/seo/jsonld';

const SITE = 'https://mayajewellers.in';

const ORG = {
  siteUrl: SITE,
  brandName: 'Maya Jewellers',
  logoUrl: `${SITE}/logo.png`,
  phone: '+91 98100 00000',
  addressLine: '24 Karol Bagh Jewellers Lane',
  city: 'New Delhi',
  state: 'Delhi',
  pincode: '110005',
  country: 'India',
  socialLinks: ['https://instagram.com/mayajewellers'],
};

describe('serialising for a script tag', () => {
  it('escapes a closing tag hidden in a product name', () => {
    // JSON.stringify escapes quotes but not `</`, so this would close the
    // script early and everything after it would be parsed as HTML.
    const out = serialiseJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('\\u003c');
  });

  it('still parses back to the same value', () => {
    // The escaping must be JSON-transparent: `<` and `<` are the same
    // character to a parser, so nothing is lost.
    const value = { name: 'Ram & Co <Jewellers>' };
    expect(JSON.parse(serialiseJsonLd(value))).toEqual(value);
  });
});

describe('the organisation node', () => {
  it('publishes the address when there is one', () => {
    const ld = organizationLd(ORG);
    expect((ld.address as Record<string, unknown>).streetAddress).toBe(ORG.addressLine);
  });

  it('omits the address entirely rather than publishing a lone country', () => {
    // A PostalAddress containing only "IN" is noise, and claims a location the
    // shop has not actually given.
    const ld = organizationLd({ siteUrl: SITE, brandName: 'X', country: 'India' });
    expect(ld.address).toBeUndefined();
  });

  it('omits a contact point when there is no phone', () => {
    expect(organizationLd({ siteUrl: SITE, brandName: 'X' }).contactPoint).toBeUndefined();
  });

  it('omits empty social links rather than publishing an empty array', () => {
    expect(organizationLd({ siteUrl: SITE, brandName: 'X', socialLinks: [] }).sameAs).toBeUndefined();
  });

  it('carries a stable @id other nodes can reference', () => {
    expect(organizationLd(ORG)['@id']).toBe(`${SITE}#organization`);
  });
});

describe('the website node', () => {
  it('declares the site search, so Google can offer a sitelinks searchbox', () => {
    const ld = webSiteLd({ siteUrl: SITE, brandName: 'Maya Jewellers' });
    const action = ld.potentialAction as { target: { urlTemplate: string } };
    expect(action.target.urlTemplate).toBe(`${SITE}/search?q={search_term_string}`);
  });
});

describe('the local business node', () => {
  it('is published when there is a real address', () => {
    const ld = localBusinessLd({ ...ORG, businessType: 'JewelryStore', priceRange: '₹₹₹' });
    expect(ld).not.toBeNull();
    expect(ld?.['@type']).toBe('JewelryStore');
    expect(ld?.priceRange).toBe('₹₹₹');
  });

  it('is withheld entirely when there is no address', () => {
    // Claiming a location the shop does not have is worse than claiming none —
    // it is the kind of mismatch that gets a business dropped from local results.
    expect(localBusinessLd({ siteUrl: SITE, brandName: 'X' })).toBeNull();
  });

  it('publishes coordinates only when both are present', () => {
    expect(localBusinessLd({ ...ORG, latitude: '28.65', longitude: '77.19' })?.geo).toBeDefined();
    expect(localBusinessLd({ ...ORG, latitude: '28.65' })?.geo).toBeUndefined();
  });

  it('defaults to JewelryStore when no type is set', () => {
    expect(localBusinessLd(ORG)?.['@type']).toBe('JewelryStore');
    expect(localBusinessLd({ ...ORG, businessType: '  ' })?.['@type']).toBe('JewelryStore');
  });
});

describe('opening hours', () => {
  it('accepts a well-formed row', () => {
    const out = parseOpeningHours([{ days: ['Monday', 'Tuesday'], opens: '11:00', closes: '20:00' }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.dayOfWeek).toEqual(['Monday', 'Tuesday']);
  });

  it('drops malformed rows rather than publishing invalid structured data', () => {
    // Google can disqualify a whole page's rich results over one bad node, so
    // dropping beats publishing.
    const out = parseOpeningHours([
      { days: ['Monday'], opens: '11:00', closes: '20:00' },
      { days: ['Funday'], opens: '11:00', closes: '20:00' },
      { days: ['Monday'], opens: '25:00', closes: '20:00' },
      { days: ['Monday'], opens: '11am', closes: '8pm' },
      { days: [], opens: '11:00', closes: '20:00' },
      { days: ['Monday'] },
      null,
      'nonsense',
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns nothing for anything that is not an array', () => {
    expect(parseOpeningHours(null)).toEqual([]);
    expect(parseOpeningHours({ days: ['Monday'] })).toEqual([]);
    expect(parseOpeningHours(undefined)).toEqual([]);
  });
});

describe('the product node', () => {
  const base = {
    siteUrl: SITE,
    brandName: 'Maya Jewellers',
    currency: 'INR',
    path: '/p/gold-ring',
    name: '22K Gold Floral Ring',
    sku: 'MJ-RING-001',
    images: [`${SITE}/a.jpg`],
    inStock: true,
  };

  it('publishes an offer with the price and availability', () => {
    const offers = productLd({ ...base, price: '24282.13' }).offers as Record<string, unknown>;
    expect(offers.price).toBe('24282.13');
    expect(offers.availability).toBe('https://schema.org/InStock');
    expect(offers.priceCurrency).toBe('INR');
  });

  it('marks an out-of-stock piece honestly', () => {
    const offers = productLd({ ...base, price: '100', inStock: false }).offers as Record<string, unknown>;
    expect(offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('omits the offer entirely when there is no price', () => {
    // "Price on request" is a real state for jewellery, and publishing a zero
    // would be a lie about what the shop is charging.
    expect(productLd({ ...base, price: null }).offers).toBeUndefined();
  });

  it('publishes a rating only when reviews exist behind it', () => {
    expect(productLd({ ...base, reviewCount: 0, reviewAverage: 4.8 }).aggregateRating).toBeUndefined();
    expect(productLd({ ...base, reviewCount: 3, reviewAverage: null }).aggregateRating).toBeUndefined();

    const rated = productLd({ ...base, reviewCount: 3, reviewAverage: 4.6 })
      .aggregateRating as Record<string, unknown>;
    expect(rated.ratingValue).toBe('4.6');
    expect(rated.reviewCount).toBe(3);
  });

  it('points the seller at the organisation node', () => {
    const offers = productLd({ ...base, price: '100' }).offers as { seller: { '@id': string } };
    expect(offers.seller['@id']).toBe(`${SITE}#organization`);
  });

  it('drops empty image entries', () => {
    expect(productLd({ ...base, images: ['', `${SITE}/a.jpg`] }).image).toEqual([`${SITE}/a.jpg`]);
  });

  it('omits a description it does not have', () => {
    expect(productLd({ ...base, description: null }).description).toBeUndefined();
  });
});

describe('breadcrumbs', () => {
  it('numbers positions from one, with no gaps', () => {
    // A gap makes Google discard the whole list, which is why this is built
    // from an array rather than written out per page.
    const ld = breadcrumbLd(SITE, [
      { name: 'Home', path: '/' },
      { name: 'Rings', path: '/c/rings' },
      { name: '22K Gold Floral Ring', path: '/p/gold-ring' },
    ]);
    const items = ld.itemListElement as { position: number; item: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[2]?.item).toBe(`${SITE}/p/gold-ring`);
  });

  it('handles a single crumb', () => {
    const items = breadcrumbLd(SITE, [{ name: 'Home', path: '/' }]).itemListElement as unknown[];
    expect(items).toHaveLength(1);
  });
});

describe('the site-wide graph', () => {
  it('holds organisation and website together', () => {
    const graph = siteGraphLd({ ...ORG, localBusinessEnabled: false })['@graph'] as { '@type': string }[];
    expect(graph.map((n) => n['@type'])).toEqual(['Organization', 'WebSite']);
  });

  it('adds the local business when it is switched on', () => {
    const graph = siteGraphLd({ ...ORG, localBusinessEnabled: true })['@graph'] as { '@type': string }[];
    expect(graph.map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'JewelryStore']);
  });

  it('leaves it out when switched on but not configured', () => {
    // The switch is not enough — without an address there is nothing truthful
    // to publish.
    const graph = siteGraphLd({
      siteUrl: SITE, brandName: 'X', localBusinessEnabled: true,
    })['@graph'] as { '@type': string }[];
    expect(graph.map((n) => n['@type'])).toEqual(['Organization', 'WebSite']);
  });
});
