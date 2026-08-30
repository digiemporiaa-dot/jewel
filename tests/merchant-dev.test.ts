import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const fetchSpy = vi.hoisted(() => vi.fn());

import { GoogleMerchantProvider } from '@/lib/merchant/google';
import { getMerchantProvider, resetMerchantProvider } from '@/lib/merchant';
import type { MerchantProduct } from '@/lib/merchant/provider';

/**
 * An unconfigured shopping channel must cost nothing.
 *
 * This runs inside the pricing cron. A shop with no Merchant Center account
 * still has to reprice its catalogue every night, so the integration has to be
 * genuinely absent rather than merely failing — the same arrangement as
 * `ShiprocketProvider.dev`.
 */

const KEY = JSON.stringify({
  client_email: 'sync@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----',
});

const product: MerchantProduct = {
  offerId: 'MJ-1', title: 'Ring', description: 'A ring',
  link: 'https://x/p/ring', imageLink: 'https://x/r.jpg',
  availability: 'in stock', price: '100', currency: 'INR',
  brand: 'Maya', material: 'Gold', color: 'Yellow', purity: '22K', category: 'Rings',
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  resetMerchantProvider();
  delete process.env.GOOGLE_MERCHANT_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_MERCHANT_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

describe('with nothing configured', () => {
  it('reports dev', () => {
    expect(new GoogleMerchantProvider().dev).toBe(true);
  });

  it('is dev with a merchant id but no key', () => {
    process.env.GOOGLE_MERCHANT_ID = '123456';
    expect(new GoogleMerchantProvider().dev).toBe(true);
  });

  it('is dev with a key but no merchant id', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = KEY;
    expect(new GoogleMerchantProvider().dev).toBe(true);
  });

  it('is dev when the key is not usable JSON', () => {
    process.env.GOOGLE_MERCHANT_ID = '123456';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = 'oops-pasted-the-filename.json';
    expect(new GoogleMerchantProvider().dev).toBe(true);
  });

  it('leaves the process alone — no request of any kind', async () => {
    const provider = new GoogleMerchantProvider();
    await provider.upsertProduct(product);
    await provider.deleteProduct('MJ-1');
    const batch = await provider.batchUpsert([product, product]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(batch).toEqual({ succeeded: 0, failed: [], skipped: true });
  });

  it('says it skipped rather than reporting a successful sync of nothing', async () => {
    // `succeeded: 0, skipped: false` would read as "sent everything, all fine".
    const batch = await new GoogleMerchantProvider().batchUpsert([product]);
    expect(batch.skipped).toBe(true);
  });
});

describe('with both settings present', () => {
  it('stops reporting dev', () => {
    process.env.GOOGLE_MERCHANT_ID = '123456';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = KEY;
    expect(new GoogleMerchantProvider().dev).toBe(false);
  });
});

describe('the provider singleton', () => {
  it('memoises like the SMS one', () => {
    const a = getMerchantProvider();
    expect(getMerchantProvider()).toBe(a);
    resetMerchantProvider();
    expect(getMerchantProvider()).not.toBe(a);
  });

  it('defaults to google', () => {
    expect(getMerchantProvider().name).toBe('google');
  });
});
