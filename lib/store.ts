import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import type { StoreSetting } from '@prisma/client';

/**
 * Fallback settings used only if the StoreSetting row is missing (e.g. before
 * the first seed). Real config always comes from the database so the platform
 * stays resellable / white-labelable — nothing brand-specific is hardcoded in
 * feature code.
 */
const FALLBACK: StoreSetting = {
  id: 'default',
  brandName: 'Maya Jewellers',
  tagline: 'Fine jewellery, crafted in Delhi',
  logoUrl: null,
  faviconUrl: null,
  phone: null,
  whatsappNumber: null,
  email: null,
  supportEmail: null,
  addressLine: null,
  city: null,
  state: null,
  pincode: null,
  country: 'India',
  gstin: null,
  currency: 'INR',
  locale: 'en-IN',
  gstPercentDefault: '3' as unknown as StoreSetting['gstPercentDefault'],
  freeShippingAbove: null,
  flatShippingFee: '0' as unknown as StoreSetting['flatShippingFee'],
  codMaxOrderValue: null,
  codTokenAmount: '0' as unknown as StoreSetting['codTokenAmount'],
  verificationCallAbove: null,
  panThreshold: null,
  rateLockMinutes: 15,
  socialLinks: null,
  footerNote: null,
  returnPolicy: null,
  updatedAt: new Date(),
  createdAt: new Date(),
};

/**
 * Cached per-request store settings. Wrapped in React `cache` so multiple server
 * components in one render share a single query.
 */
export const getStoreSettings = cache(async (): Promise<StoreSetting> => {
  try {
    const setting = await prisma.storeSetting.findUnique({
      where: { id: 'default' },
    });
    return setting ?? FALLBACK;
  } catch {
    // Never let a missing DB break rendering of the shell.
    return FALLBACK;
  }
});

export type SocialLinks = {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  pinterest?: string;
};

export function getSocialLinks(setting: StoreSetting): SocialLinks {
  return (setting.socialLinks as SocialLinks | null) ?? {};
}
