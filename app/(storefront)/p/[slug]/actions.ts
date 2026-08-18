'use server';

import { checkPincode, type PincodeResult } from '@/lib/shipping/pincode';

export async function checkPincodeAction(pincode: string): Promise<PincodeResult> {
  return checkPincode(pincode);
}
