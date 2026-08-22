'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import {
  createProduct, updateProduct,
  upsertVariant, deleteVariant,
} from '@/lib/admin/products';
import { softDeleteProduct, restoreProduct } from '@/lib/admin/soft-delete';
import { addImage, deleteImage, setPrimaryImage, moveImage } from '@/lib/admin/images';
import { setStock } from '@/lib/inventory';

export type FormResult = { ok: boolean; error?: string };

function formToObject(fd: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) obj[k] = v;
  // Checkboxes: presence = true.
  for (const key of ['gstInclusive', 'isActive', 'isFeatured', 'isBestSeller', 'isNewArrival', 'noIndex']) {
    obj[key] = fd.get(key) === 'on' || fd.get(key) === 'true';
  }
  return obj;
}

export async function createProductAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const staff = await assertPermission('products.manage');
  const res = await createProduct(formToObject(fd));
  if (!res.ok) return { ok: false, error: res.error };
  await writeAudit({ userId: staff.id, action: 'PRODUCT_CREATE', entity: 'Product', entityId: res.id, after: { sku: String(fd.get('sku') ?? '') } });
  revalidatePath('/admin/products');
  redirect(`/admin/products/${res.id}`);
}

export async function updateProductAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const staff = await assertPermission('products.manage');
  const res = await updateProduct(id, formToObject(fd));
  if (!res.ok) return { ok: false, error: res.error };
  await writeAudit({ userId: staff.id, action: 'PRODUCT_UPDATE', entity: 'Product', entityId: id });
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${id}`);
  return { ok: true };
}

/**
 * Remove a product from sale.
 *
 * Soft, not literal — an order line from last year still points at this row, and
 * a hard delete would null that reference and take the link between an invoice
 * and its product with it. The typed confirmation is checked here as well as in
 * the browser, because a confirmation only the client enforces is not one.
 */
export async function deleteProductAction(id: string, typedSku: string): Promise<FormResult> {
  const staff = await assertPermission('products.manage');

  const { prisma } = await import('@/lib/prisma');
  const product = await prisma.product.findUnique({ where: { id }, select: { sku: true } });
  if (!product) return { ok: false, error: 'Product not found' };
  if (typedSku.trim().toUpperCase() !== product.sku.toUpperCase()) {
    return { ok: false, error: `Type the SKU ${product.sku} to confirm.` };
  }

  const res = await softDeleteProduct(id, staff.id);
  if (!res.ok) return res;
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${id}`);
  // Stays on the product rather than redirecting to the list. The screen then
  // shows what actually happened — deleted, with a Restore button — instead of
  // bouncing to a list the product is no longer in, which reads like it was
  // destroyed.
  return { ok: true };
}

export async function restoreProductAction(id: string): Promise<FormResult> {
  const staff = await assertPermission('products.manage');
  const res = await restoreProduct(id, staff.id);
  if (!res.ok) return res;
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${id}`);
  return { ok: true };
}

export async function saveVariantAction(fd: FormData): Promise<FormResult> {
  await assertPermission('products.manage');
  const variantId = (fd.get('variantId') as string) || undefined;
  const obj = formToObject(fd);
  const res = await upsertVariant(obj, variantId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/admin/products/${fd.get('productId')}`);
  return { ok: true };
}

export async function deleteVariantAction(variantId: string, productId: string): Promise<FormResult> {
  await assertPermission('products.manage');
  const res = await deleteVariant(variantId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true };
}

export async function adjustStockAction(fd: FormData): Promise<FormResult> {
  const staff = await assertPermission('inventory.manage');
  const variantId = String(fd.get('variantId'));
  const productId = String(fd.get('productId'));
  const newStock = Number(fd.get('stockQty'));
  const lowStockThreshold = fd.get('lowStockThreshold') ? Number(fd.get('lowStockThreshold')) : undefined;
  if (!Number.isInteger(newStock) || newStock < 0) return { ok: false, error: 'Invalid stock quantity' };
  await setStock(variantId, newStock, { lowStockThreshold, reason: 'ADJUSTMENT', note: 'Admin adjustment' });
  await writeAudit({ userId: staff.id, action: 'INVENTORY_ADJUST', entity: 'Inventory', entityId: variantId, after: { stockQty: newStock } });
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/admin/inventory');
  return { ok: true };
}

// ── Images ───────────────────────────────────────────────────────────────────

export async function addImageAction(fd: FormData): Promise<FormResult> {
  await assertPermission('products.manage');
  const res = await addImage(formToObject(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/admin/products/${fd.get('productId')}`);
  return { ok: true };
}

export async function deleteImageAction(imageId: string, productId: string): Promise<FormResult> {
  await assertPermission('products.manage');
  const res = await deleteImage(imageId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true };
}

export async function setPrimaryImageAction(imageId: string, productId: string): Promise<FormResult> {
  await assertPermission('products.manage');
  await setPrimaryImage(imageId);
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true };
}

export async function moveImageAction(imageId: string, productId: string, direction: 'up' | 'down'): Promise<FormResult> {
  await assertPermission('products.manage');
  await moveImage(imageId, direction);
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true };
}
