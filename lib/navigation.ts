import { unstable_cache, updateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';

export type NavLink = {
  label: string;
  href: string;
  children?: NavLink[];
};

/**
 * Menu keys the layout looks up. Stable strings rather than ids, so a fresh
 * deployment for another jeweller seeds the same structure and only the labels
 * and destinations change.
 */
export const MENU_KEYS = {
  header: 'header',
  footerShop: 'footer-shop',
  footerHelp: 'footer-help',
  footerAbout: 'footer-about',
  footerLegal: 'footer-legal',
} as const;

export type MenuKey = (typeof MENU_KEYS)[keyof typeof MENU_KEYS];

export const MENU_LABELS: Record<MenuKey, string> = {
  'header': 'Header',
  'footer-shop': 'Footer — Shop',
  'footer-help': 'Footer — Help',
  'footer-about': 'Footer — About',
  'footer-legal': 'Footer — Legal',
};

/**
 * Fallback navigation, matching what the layout hard-coded before menus were
 * editable. Used when a menu is empty or the query fails: a database blip must
 * degrade to the standard menu, never to an empty header, which reads to a
 * shopper as a broken site.
 */
export const DEFAULT_MENUS: Record<MenuKey, NavLink[]> = {
  'header': [
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
  ],
  'footer-shop': [
    { label: 'New Arrivals', href: '/c/new-arrivals' },
    { label: 'Gold', href: '/c/gold' },
    { label: 'Diamond', href: '/c/diamond' },
    { label: 'Silver', href: '/c/silver' },
    { label: 'Collections', href: '/collections' },
  ],
  'footer-help': [
    { label: 'Track Order', href: '/track' },
    { label: 'Book Appointment', href: '/appointments' },
    { label: 'Shipping & Returns', href: '/pages/shipping-returns' },
    { label: 'Jewellery Care', href: '/pages/jewellery-care' },
    { label: 'Contact Us', href: '/pages/contact' },
  ],
  'footer-about': [
    { label: 'Our Story', href: '/pages/about' },
    { label: 'BIS Hallmark', href: '/pages/hallmark' },
    { label: 'Certifications', href: '/pages/certifications' },
    { label: 'Blog', href: '/blog' },
  ],
  'footer-legal': [
    { label: 'Privacy', href: '/pages/privacy' },
    { label: 'Terms', href: '/pages/terms' },
  ],
};

/** Cache tag for every menu. Busted by `revalidateNavigation()` on save. */
export const NAV_CACHE_TAG = 'navigation';

/**
 * Header and footer render on every single page, so an uncached query per
 * request is a real and pointless cost. Menus change a few times a year, so they
 * are cached indefinitely and invalidated explicitly when an admin saves.
 *
 * Errors are deliberately allowed to propagate out of the cached function:
 * `unstable_cache` does not store a rejection, so a transient database failure
 * cannot pin the fallback menu in the cache for an hour.
 */
const loadMenu = unstable_cache(
  async (key: string): Promise<NavLink[]> => {
    const menu = await prisma.navMenu.findUnique({
      where: { key },
      select: {
        items: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
          select: {
            label: true,
            href: true,
            parentId: true,
            id: true,
          },
        },
      },
    });
    if (!menu) return [];

    // One level of nesting: top-level items keep their children inline.
    const byParent = new Map<string, NavLink[]>();
    for (const item of menu.items) {
      if (!item.parentId) continue;
      const siblings = byParent.get(item.parentId) ?? [];
      siblings.push({ label: item.label, href: item.href });
      byParent.set(item.parentId, siblings);
    }

    return menu.items
      .filter((item) => !item.parentId)
      .map((item) => {
        const children = byParent.get(item.id);
        return children?.length
          ? { label: item.label, href: item.href, children }
          : { label: item.label, href: item.href };
      });
  },
  ['nav-menu'],
  { tags: [NAV_CACHE_TAG] }
);

/** Read one menu, falling back to the built-in defaults when empty or broken. */
export async function getMenu(key: MenuKey): Promise<NavLink[]> {
  try {
    const items = await loadMenu(key);
    if (items.length === 0) return DEFAULT_MENUS[key];
    return items;
  } catch (e) {
    console.error(`[navigation] failed to load menu "${key}"`, e);
    return DEFAULT_MENUS[key];
  }
}

/** The header menu. Kept as a named export because the layout reads it directly. */
export async function getNavigation(): Promise<NavLink[]> {
  return getMenu(MENU_KEYS.header);
}

/** Read the four footer column menus in one go. */
export async function getFooterMenus(): Promise<{ key: MenuKey; title: string; links: NavLink[] }[]> {
  const [shop, help, about] = await Promise.all([
    getMenu(MENU_KEYS.footerShop),
    getMenu(MENU_KEYS.footerHelp),
    getMenu(MENU_KEYS.footerAbout),
  ]);
  return [
    { key: MENU_KEYS.footerShop, title: 'Shop', links: shop },
    { key: MENU_KEYS.footerHelp, title: 'Help', links: help },
    { key: MENU_KEYS.footerAbout, title: 'About', links: about },
  ];
}

/** Invalidate every cached menu. Call after any navigation mutation. */
export function revalidateNavigation(): void {
  // `updateTag`, not `revalidateTag`. Next 16 split the two: `revalidateTag` now
  // takes a cache-life profile and marks a tag stale, while `updateTag` expires it
  // immediately with read-your-own-writes semantics — which is exactly what an
  // admin save needs. Every caller of this is a Server Action, which is the only
  // place `updateTag` may be called from.
  updateTag(NAV_CACHE_TAG);
}
