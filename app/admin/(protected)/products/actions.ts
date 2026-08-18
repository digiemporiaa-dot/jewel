'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import {
  createProduct, updateProduct, deleteProduct,
  upsertVariant, deleteVariant,
} from '@/lib/admin/products';
import { addImage, deleteImage, setPrimaryImage, moveImage } from '@/lib/admin/images';
import { setStock } from '@/lib/inventory';

export type FormResult = { ok: boolean; error?: string };

function formToObject(fd: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) obj[k] = v;
  // Checkboxes: presence = true.
  for (const key of ['gstInclusive', 'isActive', 'isFeatured', 'isBestSeller', 'isNewArrival']) {
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

export async function deleteProductAction(id: string): Promise<FormResult> {
  const staff = await assertPermission('products.manage');
  const before = await import('@/lib/prisma').then((m) => m.prisma.product.findUnique({ where: { id }, select: { sku: true, name: true } }));
  await deleteProduct(id);
  await writeAudit({ userId: staff.id, action: 'PRODUCT_DELETE', entity: 'Product', entityId: id, before });
  revalidatePath('/admin/products');
  redirect('/admin/products');
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
