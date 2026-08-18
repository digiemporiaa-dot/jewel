import 'server-only';
import { prisma } from '@/lib/prisma';

export type PincodeResult = {
  pincode: string;
  serviceable: boolean;
  codAvailable: boolean;
  etaDays: number | null;
  message: string;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h (brief §21)

/**
 * Stub serviceability provider. Phase 5 replaces this with the real Shiprocket
 * serviceability call behind lib/shipping/provider.ts; the 24h cache and the
 * public shape stay the same.
 */
function providerLookup(pincode: string): Omit<PincodeResult, 'pincode' | 'message'> {
  // Rough metro-vs-rest ETA heuristic on the leading digit.
  const lead = Number(pincode[0]);
  const etaDays = [1, 4, 6].includes(lead) ? 3 : lead >= 7 ? 6 : 5;
  return { serviceable: true, codAvailable: true, etaDays };
}

export async function checkPincode(raw: string): Promise<PincodeResult> {
  const pincode = raw.trim();
  if (!/^\d{6}$/.test(pincode)) {
    return { pincode, serviceable: false, codAvailable: false, etaDays: null, message: 'Enter a valid 6-digit pincode' };
  }

  const cached = await prisma.pincodeServiceability.findUnique({ where: { pincode } });
  const fresh = cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS;

  let data: Omit<PincodeResult, 'pincode' | 'message'>;
  if (fresh && cached) {
    data = { serviceable: cached.serviceable, codAvailable: cached.codAvailable, etaDays: cached.etaDays };
  } else {
    data = providerLookup(pincode);
    await prisma.pincodeServiceability.upsert({
      where: { pincode },
      create: { pincode, serviceable: data.serviceable, codAvailable: data.codAvailable, etaDays: data.etaDays },
      update: { serviceable: data.serviceable, codAvailable: data.codAvailable, etaDays: data.etaDays, cachedAt: new Date() },
    });
  }

  return {
    pincode,
    ...data,
    message: data.serviceable
      ? `Delivers in ${data.etaDays} day${data.etaDays === 1 ? '' : 's'}${data.codAvailable ? ' · COD available' : ''}`
      : 'Not serviceable at this pincode',
  };
}
