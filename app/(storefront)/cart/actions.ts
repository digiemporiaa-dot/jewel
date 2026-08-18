'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ensureSessionToken, getSessionToken } from '@/lib/session';
import { addToCart, updateCartItem, removeCartItem, CartError } from '@/lib/cart';

const addSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
});

export type CartActionResult = { ok: boolean; error?: string };

export async function addToCartAction(input: { productId: string; variantId: string; quantity?: number }): Promise<CartActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid item' };
  const token = await ensureSessionToken();
  try {
    await addToCart(token, parsed.data.productId, parsed.data.variantId, parsed.data.quantity);
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof CartError ? e.message : 'Could not add to cart' };
  }
}

export async function updateCartItemAction(itemId: string, quantity: number): Promise<CartActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Cart not found' };
  try {
    await updateCartItem(token, itemId, quantity);
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof CartError ? e.message : 'Could not update cart' };
  }
}

export async function removeCartItemAction(itemId: string): Promise<CartActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: true };
  await removeCartItem(token, itemId);
  revalidatePath('/cart');
  return { ok: true };
}
