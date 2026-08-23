'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerId } from '@/lib/customer-session';
import { saveAddress, deleteAddress, setDefaultAddress } from '@/lib/addresses';

export type Result = { ok: boolean; error?: string };

/**
 * The customer id comes from the session cookie, never from the form.
 *
 * Every action here re-derives it. A `customerId` field in a submitted form is
 * a request to edit somebody else's address book.
 */
async function requireCustomer(): Promise<string | null> {
  return getCustomerId();
}

export async function saveAddressAction(fd: FormData): Promise<Result> {
  const customerId = await requireCustomer();
  if (!customerId) return { ok: false, error: 'Please sign in again.' };

  const addressId = (fd.get('addressId') as string) || undefined;
  const res = await saveAddress(customerId, {
    label: fd.get('label') ?? '',
    name: fd.get('name') ?? '',
    phone: fd.get('phone') ?? '',
    line1: fd.get('line1') ?? '',
    line2: fd.get('line2') ?? '',
    city: fd.get('city') ?? '',
    state: fd.get('state') ?? '',
    pincode: fd.get('pincode') ?? '',
    isDefault: fd.get('isDefault') === 'on',
  }, addressId);

  if (!res.ok) return res;
  revalidatePath('/my-account/addresses');
  revalidatePath('/checkout');
  return { ok: true };
}

export async function deleteAddressAction(addressId: string): Promise<Result> {
  const customerId = await requireCustomer();
  if (!customerId) return { ok: false, error: 'Please sign in again.' };
  const res = await deleteAddress(customerId, addressId);
  revalidatePath('/my-account/addresses');
  return res;
}

export async function setDefaultAddressAction(addressId: string): Promise<Result> {
  const customerId = await requireCustomer();
  if (!customerId) return { ok: false, error: 'Please sign in again.' };
  const res = await setDefaultAddress(customerId, addressId);
  revalidatePath('/my-account/addresses');
  revalidatePath('/checkout');
  return res;
}
