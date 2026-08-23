import 'server-only';
import { prisma } from '@/lib/prisma';
import { addressSchema } from '@/lib/validations/address';

// Re-exported so callers have one import for addresses, while the rules stay in
// a module tests can reach without `server-only` in the way.
export { addressSchema };
export type { AddressInput } from '@/lib/validations/address';

/**
 * Saved shipping addresses.
 *
 * The `Address` model has existed since the schema was written — including an
 * `isDefault` flag — and nothing ever wrote a row to it. Checkout collected an
 * address, snapshotted it onto the order and forgot it, so a returning customer
 * retyped their address every time. At these order values that is a real drop-off:
 * a ₹1.2 lakh purchase abandoned at the address step is not a small loss.
 *
 * Ownership is enforced on every read and write by `customerId`, never by a
 * client-sent flag — an address id in a form field is somebody's guess at
 * somebody else's id until the query proves otherwise.
 */

export type SavedAddress = {
  id: string;
  label: string | null;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
};

/** Every address this customer has saved, default first. */
export async function listAddresses(customerId: string): Promise<SavedAddress[]> {
  return prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
}

/**
 * The one to preselect at checkout.
 *
 * Falls back to the most recently updated when nothing is marked default, so a
 * customer with exactly one address never sees an empty form.
 */
export async function defaultAddress(customerId: string): Promise<SavedAddress | null> {
  const [address] = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    take: 1,
  });
  return address ?? null;
}

export type Result = { ok: true; id: string } | { ok: false; error: string };

const MAX_ADDRESSES = 10;

export async function saveAddress(
  customerId: string,
  raw: unknown,
  addressId?: string
): Promise<Result> {
  const parsed = addressSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid address' };
  const d = parsed.data;

  if (!addressId) {
    const count = await prisma.address.count({ where: { customerId } });
    if (count >= MAX_ADDRESSES) {
      return { ok: false, error: `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.` };
    }
  }

  // The first address a customer saves is their default whether they asked or
  // not — otherwise checkout has nothing to preselect and the feature does
  // nothing on the one order that matters most, their second.
  const existing = await prisma.address.count({ where: { customerId } });
  const makeDefault = d.isDefault === true || existing === 0;

  const data = {
    label: d.label?.trim() ? d.label.trim() : null,
    name: d.name,
    phone: d.phone,
    line1: d.line1,
    line2: d.line2?.trim() ? d.line2.trim() : null,
    city: d.city,
    state: d.state,
    pincode: d.pincode,
    isDefault: makeDefault,
  };

  const id = await prisma.$transaction(async (tx) => {
    // "Default" is exactly one row, enforced here rather than by a partial
    // unique index — two defaults would make checkout's preselection arbitrary.
    if (makeDefault) {
      await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
    }

    if (addressId) {
      // Ownership in the `where`, not checked beforehand: `updateMany` scoped to
      // the customer simply matches nothing when the id belongs to somebody else.
      const res = await tx.address.updateMany({ where: { id: addressId, customerId }, data });
      if (res.count === 0) throw new Error('NOT_FOUND');
      return addressId;
    }

    const created = await tx.address.create({ data: { ...data, customerId } });
    return created.id;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'NOT_FOUND') return null;
    throw e;
  });

  if (!id) return { ok: false, error: 'Address not found' };
  return { ok: true, id };
}

export async function deleteAddress(customerId: string, addressId: string): Promise<{ ok: boolean; error?: string }> {
  const removed = await prisma.address.deleteMany({ where: { id: addressId, customerId } });
  if (removed.count === 0) return { ok: false, error: 'Address not found' };

  // Deleting the default leaves nobody holding it, so the next most recent
  // takes over — a customer with addresses should never have none preselected.
  const stillDefault = await prisma.address.count({ where: { customerId, isDefault: true } });
  if (stillDefault === 0) {
    const [next] = await prisma.address.findMany({ where: { customerId }, orderBy: { updatedAt: 'desc' }, take: 1 });
    if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  return { ok: true };
}

export async function setDefaultAddress(customerId: string, addressId: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await prisma.address.count({ where: { id: addressId, customerId } });
  if (owned === 0) return { ok: false, error: 'Address not found' };

  await prisma.$transaction([
    prisma.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } }),
    prisma.address.update({ where: { id: addressId }, data: { isDefault: true } }),
  ]);
  return { ok: true };
}

/**
 * Remember the address an order was placed with.
 *
 * Called after a successful order, best-effort: a saved-address write must never
 * fail a checkout. Deduplicated on the fields that make an address the same
 * place, so ordering three times from home does not leave three identical rows.
 */
export async function rememberAddress(customerId: string, address: {
  name: string; phone: string; line1: string; line2?: string | null;
  city: string; state: string; pincode: string;
}): Promise<void> {
  try {
    const duplicate = await prisma.address.findFirst({
      where: {
        customerId,
        line1: address.line1,
        pincode: address.pincode,
        // Case and spacing vary between typings of the same address; the line
        // and the pincode together are enough to call it the same place.
      },
      select: { id: true },
    });
    if (duplicate) return;

    const existing = await prisma.address.count({ where: { customerId } });
    if (existing >= MAX_ADDRESSES) return;

    await prisma.address.create({
      data: {
        customerId,
        name: address.name,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        isDefault: existing === 0,
      },
    });
  } catch (e) {
    console.error('[addresses] could not remember the order address', e);
  }
}
