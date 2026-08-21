'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { revalidateNavigation, DEFAULT_MENUS } from '@/lib/navigation';

export type Result = { ok: boolean; error?: string };

/**
 * Navigation is store configuration, so it sits behind `settings.manage` rather
 * than earning a permission of its own. Every mutation re-checks it server-side:
 * hiding the sidebar entry is not authorization.
 */
const PERMISSION = 'settings.manage' as const;

/**
 * Accepted destinations. Anything else — `javascript:`, a protocol-relative
 * `//evil.example`, an off-site absolute URL — is refused, because these links
 * are rendered into every page of the storefront.
 */
const hrefSchema = z
  .string()
  .trim()
  .min(1, 'Link is required')
  .max(300)
  .refine(
    (v) => /^\/(?!\/)/.test(v) || /^https:\/\/[^\s]+$/i.test(v),
    'Use a path starting with / or a full https:// URL'
  );

const itemSchema = z.object({
  menuId: z.string().min(1),
  label: z.string().trim().min(1, 'Label is required').max(60),
  href: hrefSchema,
  parentId: z.string().trim().optional().or(z.literal('')),
});

/** Bust both the storefront menu cache and the admin view. */
function revalidateAll(): void {
  revalidateNavigation();
  revalidatePath('/admin/navigation');
}

export async function createNavItemAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const parsed = itemSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const menu = await prisma.navMenu.findUnique({ where: { id: parsed.data.menuId }, select: { id: true } });
  if (!menu) return { ok: false, error: 'Menu not found' };

  const parentId = parsed.data.parentId || null;
  if (parentId) {
    // One level of nesting only — the header renders a single dropdown tier, and
    // a deeper tree would simply not be shown.
    const parent = await prisma.navItem.findUnique({ where: { id: parentId }, select: { menuId: true, parentId: true } });
    if (!parent) return { ok: false, error: 'Parent item not found' };
    if (parent.menuId !== menu.id) return { ok: false, error: 'Parent belongs to a different menu' };
    if (parent.parentId) return { ok: false, error: 'Menus support one level of nesting' };
  }

  const last = await prisma.navItem.findFirst({
    where: { menuId: menu.id, parentId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const item = await prisma.navItem.create({
    data: {
      menuId: menu.id,
      label: parsed.data.label,
      href: parsed.data.href,
      parentId,
      order: (last?.order ?? -1) + 1,
    },
  });
  await writeAudit({
    userId: staff.id,
    action: 'NAV_ITEM_CREATE',
    entity: 'NavItem',
    entityId: item.id,
    after: { label: item.label, href: item.href, menuId: menu.id },
  });
  revalidateAll();
  return { ok: true };
}

export async function updateNavItemAction(id: string, fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const parsed = z
    .object({ label: itemSchema.shape.label, href: itemSchema.shape.href })
    .safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const before = await prisma.navItem.findUnique({ where: { id }, select: { label: true, href: true } });
  if (!before) return { ok: false, error: 'Item not found' };

  await prisma.navItem.update({ where: { id }, data: { label: parsed.data.label, href: parsed.data.href } });
  await writeAudit({
    userId: staff.id,
    action: 'NAV_ITEM_UPDATE',
    entity: 'NavItem',
    entityId: id,
    before,
    after: parsed.data,
  });
  revalidateAll();
  return { ok: true };
}

export async function toggleNavItemAction(id: string): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const item = await prisma.navItem.findUnique({ where: { id }, select: { isActive: true, label: true } });
  if (!item) return { ok: false, error: 'Item not found' };

  await prisma.navItem.update({ where: { id }, data: { isActive: !item.isActive } });
  await writeAudit({
    userId: staff.id,
    action: 'NAV_ITEM_TOGGLE',
    entity: 'NavItem',
    entityId: id,
    before: { isActive: item.isActive },
    after: { isActive: !item.isActive },
  });
  revalidateAll();
  return { ok: true };
}

export async function deleteNavItemAction(id: string): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const item = await prisma.navItem.findUnique({
    where: { id },
    select: { label: true, href: true, menuId: true, _count: { select: { children: true } } },
  });
  if (!item) return { ok: false, error: 'Item not found' };

  // Children cascade at the database level; say so rather than silently removing
  // links the admin may not realise were nested under this one.
  await prisma.navItem.delete({ where: { id } });
  await writeAudit({
    userId: staff.id,
    action: 'NAV_ITEM_DELETE',
    entity: 'NavItem',
    entityId: id,
    before: { label: item.label, href: item.href, childrenRemoved: item._count.children },
  });
  revalidateAll();
  return { ok: true };
}

/**
 * Swap an item with its neighbour. Scoped to the same menu *and* the same parent,
 * so moving a dropdown child can never lift it out of its parent, and the two
 * writes go in one transaction so a failure cannot leave two items sharing an
 * order value.
 */
export async function moveNavItemAction(id: string, direction: 'up' | 'down'): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const item = await prisma.navItem.findUnique({ where: { id } });
  if (!item) return { ok: false, error: 'Item not found' };

  const neighbour = await prisma.navItem.findFirst({
    where: {
      menuId: item.menuId,
      parentId: item.parentId,
      order: direction === 'up' ? { lt: item.order } : { gt: item.order },
    },
    orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
  });
  if (!neighbour) return { ok: true }; // already at the edge

  await prisma.$transaction([
    prisma.navItem.update({ where: { id: item.id }, data: { order: neighbour.order } }),
    prisma.navItem.update({ where: { id: neighbour.id }, data: { order: item.order } }),
  ]);
  await writeAudit({
    userId: staff.id,
    action: 'NAV_ITEM_REORDER',
    entity: 'NavItem',
    entityId: item.id,
    after: { direction, menuId: item.menuId },
  });
  revalidateAll();
  return { ok: true };
}

/**
 * Restore a menu to the built-in defaults. Useful when a shop has emptied a menu
 * and wants the standard structure back without hand-typing it.
 */
export async function resetMenuAction(menuId: string): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const menu = await prisma.navMenu.findUnique({ where: { id: menuId }, select: { key: true } });
  if (!menu) return { ok: false, error: 'Menu not found' };

  const defaults = DEFAULT_MENUS[menu.key as keyof typeof DEFAULT_MENUS];
  if (!defaults) return { ok: false, error: 'No defaults exist for this menu' };

  await prisma.$transaction([
    prisma.navItem.deleteMany({ where: { menuId } }),
    prisma.navItem.createMany({
      data: defaults.map((d, i) => ({ menuId, label: d.label, href: d.href, order: i })),
    }),
  ]);
  await writeAudit({
    userId: staff.id,
    action: 'NAV_MENU_RESET',
    entity: 'NavMenu',
    entityId: menuId,
    after: { key: menu.key, items: defaults.length },
  });
  revalidateAll();
  return { ok: true };
}
