import { cache } from 'react';
import { prisma } from '@/lib/prisma';

export type NavLink = { label: string; href: string };

/**
 * Default storefront navigation. Admins can override these via the NavItem table
 * (brief §8: "Admin should be able to control navigation items"); this is the
 * fallback used before any NavItem rows exist.
 */
export const DEFAULT_NAV: NavLink[] = [
  { label: 'New Arrivals', href: '/c/new-arrivals' },
  { label: 'Gold', href: '/c/gold' },
  { label: 'Diamond', href: '/c/diamond' },
  { label: 'Silver', href: '/c/silver' },
  { label: 'Rings', href: '/c/rings' },
  { label: 'Earrings', href: '/c/earrings' },
  { label: 'Necklaces', href: '/c/necklaces' },
  { label: 'Bracelets', href: '/c/bracelets' },
  { label: 'Bangles', href: '/c/bangles' },
  { label: 'Mangalsutra', href: '/c/mangalsutra' },
  { label: 'Wedding', href: '/c/wedding' },
  { label: 'Gifting', href: '/c/gifting' },
  { label: 'Collections', href: '/collections' },
];

export const getNavigation = cache(async (): Promise<NavLink[]> => {
  try {
    const items = await prisma.navItem.findMany({
      where: { isActive: true, parentId: null },
      orderBy: { order: 'asc' },
    });
    if (items.length === 0) return DEFAULT_NAV;
    return items.map((i) => ({ label: i.label, href: i.href }));
  } catch {
    return DEFAULT_NAV;
  }
});
