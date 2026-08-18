'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ensureSessionToken } from '@/lib/session';
import { toggleWishlist } from '@/lib/wishlist';
import { prisma } from '@/lib/prisma';
import { addToCart, CartError } from '@/lib/cart';

export async function toggleWishlistAction(productId: string): Promise<{ ok: boolean; saved?: boolean; error?: string }> {
  const parsed = z.string().min(1).safeParse(productId);
  if (!parsed.success) return { ok: false, error: 'Invalid product' };
  const token = await ensureSessionToken();
  const { saved } = await toggleWishlist(parsed.data, token);
  revalidatePath('/wishlist');
  return { ok: true, saved };
}

/** Move a wishlist item into the bag using its first available variant. */
export async function moveToBagAction(productId: string): Promise<{ ok: boolean; error?: string }> {
  const token = await ensureSessionToken();
  const variants = await prisma.productVariant.findMany({
    where: { productId, isActive: true },
    include: { inventory: true, product: { select: { fulfilmentType: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (variants.length === 0) return { ok: false, error: 'Unavailable' };
  const pick =
    variants.find((v) => v.product.fulfilmentType === 'MADE_TO_ORDER' || (v.inventory ? v.inventory.stockQty - v.inventory.reservedQty > 0 : false)) ??
    variants[0];
  if (!pick) return { ok: false, error: 'Unavailable' };

  try {
    await addToCart(token, productId, pick.id, 1);
    await toggleWishlist(productId, token); // remove from wishlist after moving
    revalidatePath('/wishlist');
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof CartError ? e.message : 'Could not move to bag' };
  }
}
