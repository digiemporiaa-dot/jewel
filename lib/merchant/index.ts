import 'server-only';
import type { MerchantProvider } from '@/lib/merchant/provider';
import { GoogleMerchantProvider } from '@/lib/merchant/google';

let cached: MerchantProvider | null = null;

/**
 * Resolve the configured shopping channel. `MERCHANT_PROVIDER` selects the
 * implementation so a future client can switch channels with an env change
 * alone — the same arrangement as `getSmsProvider`.
 */
export function getMerchantProvider(): MerchantProvider {
  if (!cached) {
    switch ((process.env.MERCHANT_PROVIDER ?? 'google').toLowerCase()) {
      case 'google':
      default:
        cached = new GoogleMerchantProvider();
    }
  }
  return cached;
}

/** Test seam: forget the memoised provider so a changed env is re-read. */
export function resetMerchantProvider(): void {
  cached = null;
}

export type { MerchantProvider, MerchantProduct, BatchResult } from '@/lib/merchant/provider';
