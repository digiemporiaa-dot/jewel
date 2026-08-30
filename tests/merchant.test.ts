import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import { chunk, BATCH_SIZE, JEWELLERY_CATEGORY_ID, type MerchantProduct } from '@/lib/merchant/provider';
import { toGoogleProduct, stripHtml, truncate, formatPrice } from '@/lib/merchant/mapping';
import { escapeXml, buildGoogleShoppingFeed } from '@/lib/merchant/feed';
import { readBatchResponse, parseServiceAccount } from '@/lib/merchant/google';

const item = (over: Partial<MerchantProduct> = {}): MerchantProduct => ({
  offerId: 'MJ-RING-001',
  title: 'Kundan Polki Ring',
  description: 'A hand-set ring.',
  link: 'https://tickettofly.in/p/kundan-polki-ring',
  imageLink: 'https://cdn.example.com/ring.jpg',
  availability: 'in stock',
  price: '48250.5',
  currency: 'INR',
  brand: 'Maya Jewellers',
  material: 'Gold',
  color: 'Yellow',
  purity: '22K',
  category: 'Rings',
  ...over,
});

describe("mapping a product into Google's schema", () => {
  it('maps every field the brief names', () => {
    const g = toGoogleProduct(item());
    expect(g.offerId).toBe('MJ-RING-001');
    expect(g.title).toBe('Kundan Polki Ring');
    expect(g.description).toBe('A hand-set ring.');
    expect(g.link).toBe('https://tickettofly.in/p/kundan-polki-ring');
    expect(g.imageLink).toBe('https://cdn.example.com/ring.jpg');
    expect(g.availability).toBe('in stock');
    expect(g.price).toEqual({ value: '48250.50', currency: 'INR' });
    expect(g.brand).toBe('Maya Jewellers');
    expect(g.condition).toBe('new');
    expect(g.googleProductCategory).toBe(JEWELLERY_CATEGORY_ID);
    expect(g.material).toBe('Gold');
    expect(g.color).toBe('Yellow');
    expect(g.customLabel0).toBe('22K');
    expect(g.customLabel1).toBe('Rings');
    expect(g.identifierExists).toBe(false);
  });

  it('sends the numeric jewellery category, not the path', () => {
    // The wording of the path changes between taxonomy revisions; 188 does not.
    expect(JEWELLERY_CATEGORY_ID).toBe('188');
  });

  it('formats the price to exactly two decimals, as a string', () => {
    // A number serialises as 19999.9 and Google reads a price ten paise short
    // of the landing page, then suspends the item for a price mismatch.
    expect(formatPrice('19999.9')).toBe('19999.90');
    expect(formatPrice(48250)).toBe('48250.00');
    expect(formatPrice('0')).toBe('0.00');
    expect(formatPrice('not a number')).toBe('0.00');
    expect(typeof toGoogleProduct(item()).price.value).toBe('string');
  });

  it('omits optional fields rather than sending them empty', () => {
    // Google treats "" as a supplied value and warns about a blank colour;
    // an absent field is simply not known.
    const g = toGoogleProduct(item({ material: null, color: null, purity: null, imageLink: null }));
    expect('material' in g).toBe(false);
    expect('color' in g).toBe(false);
    expect('customLabel0' in g).toBe(false);
    expect('imageLink' in g).toBe(false);
  });

  it('never claims a gender the shop never recorded', () => {
    // There is no target-audience column on Product. Guessing one from a
    // category name would put a claim on the listing nobody made.
    expect('gender' in toGoogleProduct(item())).toBe(false);
  });

  it('marks an out-of-stock piece rather than hiding it', () => {
    expect(toGoogleProduct(item({ availability: 'out of stock' })).availability).toBe('out of stock');
  });
});

describe('description text', () => {
  it('strips markup, keeping the words apart', () => {
    // "one</p><p>two" is two sentences, not "onetwo".
    expect(stripHtml('<p>Hand set</p><p>in 22K gold</p>')).toBe('Hand set in 22K gold');
    expect(stripHtml('<b>Gold</b> &amp; silver')).toBe('Gold & silver');
    expect(stripHtml('a<br>b')).toBe('a b');
    expect(stripHtml(null)).toBe('');
  });

  it('drops a script tag with its contents, not just the tags', () => {
    expect(stripHtml('<script>alert(1)</script>Ring')).toBe('Ring');
  });

  it('truncates on a word boundary', () => {
    const long = 'Kundan Polki Ring set in twenty two carat gold with uncut diamonds';
    const cut = truncate(long, 30);
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(long.startsWith(cut)).toBe(true);
    expect(cut.endsWith(' ')).toBe(false);
  });

  it('leaves a short title alone', () => {
    expect(truncate('Ring', 150)).toBe('Ring');
  });
});

describe('batching', () => {
  it('splits at the Content API limit of 100', () => {
    expect(BATCH_SIZE).toBe(100);
    const groups = chunk(Array.from({ length: 250 }, (_, i) => i));
    expect(groups.map((g) => g.length)).toEqual([100, 100, 50]);
  });

  it('sends one group when everything fits', () => {
    expect(chunk([1, 2, 3]).length).toBe(1);
  });

  it('sends nothing for an empty catalogue', () => {
    expect(chunk([])).toEqual([]);
  });

  it('loses nothing across the split', () => {
    const items = Array.from({ length: 237 }, (_, i) => `sku-${i}`);
    expect(chunk(items).flat()).toEqual(items);
  });
});

describe('reading a batch reply', () => {
  const group = [item({ offerId: 'A' }), item({ offerId: 'B' }), item({ offerId: 'C' })];

  it('counts a clean reply', () => {
    const res = readBatchResponse({ entries: [{ batchId: 0 }, { batchId: 1 }, { batchId: 2 }] }, group);
    expect(res.succeeded).toBe(3);
    expect(res.failed).toEqual([]);
  });

  it('does not call a 200 with errors in it a success', () => {
    // Content API returns per-entry results: a batch of a hundred can come back
    // 200 with ninety-nine rejections inside. Reading the status as the outcome
    // is how a sync reports success while the catalogue stops updating.
    const res = readBatchResponse(
      { entries: [{ batchId: 0 }, { batchId: 1, errors: { errors: [{ message: 'missing image link' }] } }, { batchId: 2 }] },
      group
    );
    expect(res.succeeded).toBe(2);
    expect(res.failed).toEqual([{ offerId: 'B', error: 'missing image link' }]);
  });

  it('claims nothing from a reply it cannot read', () => {
    const res = readBatchResponse({ nonsense: true }, group);
    expect(res.succeeded).toBe(0);
    expect(res.failed).toHaveLength(3);
  });
});

describe('the service account key', () => {
  it('un-escapes the newlines every environment mangles differently', () => {
    // A key pasted through a shell arrives with \\n as two characters, and
    // signing then fails with an error that says nothing about newlines.
    const raw = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'line1\\nline2' });
    const parsed = parseServiceAccount(raw);
    expect(parsed?.private_key).toBe('line1\nline2');
  });

  it('returns null for anything unusable rather than throwing', () => {
    // A configuration mistake must leave the shop running without the
    // integration, not take it down.
    for (const bad of [undefined, '', '   ', 'not json', '{}', JSON.stringify({ client_email: 'a' })]) {
      expect(parseServiceAccount(bad), String(bad)).toBeNull();
    }
  });
});

describe('image and link addresses', () => {
  const catalogue = readFileSync(join(__dirname, '..', 'lib/merchant/catalogue.ts'), 'utf8');

  it('makes every image address absolute', () => {
    // Found by reading a real feed, not by a fixture. Image URLs in this
    // database are a mix — R2 uploads come back absolute, seeded and
    // hand-entered ones are site-relative — and `/products/ring.jpg` renders
    // correctly on our own pages while Google rejects every item carrying one,
    // because the feed is fetched from outside where that path means nothing.
    expect(catalogue).toContain('const absolute = (url: string): string | null');
    expect(catalogue).toContain('if (/^https?:\\/\\//i.test(trimmed)) return trimmed;');
    expect(catalogue).toContain('p.images[0] ? absolute(p.images[0].url) : null');
    expect(catalogue).toContain('.map((i) => absolute(i.url))');
  });

  it('never passes a raw image url straight through', () => {
    expect(catalogue).not.toContain('imageLink: p.images[0]?.url');
  });
});

describe('the XML feed', () => {
  it('escapes an ampersand, which is in half the product names here', () => {
    // A bare & does not make the feed wrong, it makes it unparseable — Google
    // rejects the whole file, so one name breaks every listing.
    expect(escapeXml('Ruby & Gold')).toBe('Ruby &amp; Gold');
    expect(escapeXml('<b>')).toBe('&lt;b&gt;');
    expect(escapeXml('5" hoop')).toBe('5&quot; hoop');
  });

  it('removes control characters, which cannot be escaped at all', () => {
    expect(escapeXml('Ring\x00\x07 set')).toBe('Ring set');
  });

  it('builds a feed Google can read', () => {
    const xml = buildGoogleShoppingFeed([item({ title: 'Ruby & Gold Ring' })], {
      title: 'Maya Jewellers', link: 'https://tickettofly.in', description: 'Fine jewellery',
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain('<g:id>MJ-RING-001</g:id>');
    expect(xml).toContain('<title>Ruby &amp; Gold Ring</title>');
    expect(xml).toContain('<g:price>48250.50 INR</g:price>');
    expect(xml).toContain('<g:google_product_category>' + JEWELLERY_CATEGORY_ID + '</g:google_product_category>');
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(xml).not.toContain('Ruby & Gold');
  });

  it('quotes the same price the API path sends', () => {
    // Two readers advertising two prices for one piece is the exact failure
    // this feature exists to prevent.
    const p = item({ price: '19999.9' });
    const xml = buildGoogleShoppingFeed([p], { title: 't', link: 'l', description: 'd' });
    expect(xml).toContain('<g:price>' + toGoogleProduct(p).price.value + ' INR</g:price>');
  });

  it('omits a field it has no value for', () => {
    const xml = buildGoogleShoppingFeed([item({ color: null, material: null })], { title: 't', link: 'l', description: 'd' });
    expect(xml).not.toContain('<g:color>');
    expect(xml).not.toContain('<g:material>');
  });
});
