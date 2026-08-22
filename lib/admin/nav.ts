import type { Permission } from '@/lib/auth/rbac';
import { can } from '@/lib/auth/rbac';
import type { Role } from '@prisma/client';

export type AdminNavItem = {
  label: string;
  href: string;
  permission: Permission;
};

export type AdminNavSection = {
  title: string;
  items: AdminNavItem[];
};

/**
 * Full admin navigation. Each entry declares the permission required to see AND
 * to use it. The sidebar filters by `can()` — but the same permission is
 * re-checked server-side on the target route (menu visibility is not auth).
 */
export const ADMIN_NAV: AdminNavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/admin', permission: 'dashboard.view' }],
  },
  {
    title: 'Catalog',
    items: [
      { label: 'Products', href: '/admin/products', permission: 'products.manage' },
      { label: 'Categories', href: '/admin/categories', permission: 'categories.manage' },
      { label: 'Collections', href: '/admin/collections', permission: 'collections.manage' },
      { label: 'Inventory', href: '/admin/inventory', permission: 'inventory.manage' },
      { label: 'Metal Rates', href: '/admin/rates', permission: 'rates.manage' },
      { label: 'Making Charges', href: '/admin/making-charges', permission: 'making_charges.manage' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { label: 'Orders', href: '/admin/orders', permission: 'orders.view' },
      { label: 'Shipments', href: '/admin/shipments', permission: 'shipments.manage' },
      { label: 'Coupons', href: '/admin/coupons', permission: 'coupons.manage' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { label: 'Customers', href: '/admin/customers', permission: 'customers.view' },
      { label: 'CRM & Leads', href: '/admin/crm', permission: 'crm.access' },
      { label: 'Appointments', href: '/admin/appointments', permission: 'appointments.manage' },
      { label: 'Reviews', href: '/admin/reviews', permission: 'reviews.moderate' },
    ],
  },
  {
    title: 'Content',
    items: [
      { label: 'CMS Pages', href: '/admin/cms', permission: 'cms.manage' },
      { label: 'Blog', href: '/admin/blog', permission: 'blog.manage' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Campaigns', href: '/admin/campaigns', permission: 'settings.manage' },
      { label: 'Email Templates', href: '/admin/marketing/templates', permission: 'settings.manage' },
      { label: 'Tracking & Pixels', href: '/admin/marketing/tags', permission: 'settings.manage' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Settings', href: '/admin/settings', permission: 'settings.manage' },
      { label: 'Navigation', href: '/admin/navigation', permission: 'settings.manage' },
      { label: 'Staff & Roles', href: '/admin/staff', permission: 'staff.manage' },
      { label: 'Audit Log', href: '/admin/audit', permission: 'audit.view' },
    ],
  },
];

/** Filter the nav down to what this role may access. */
export function navForRole(role: Role): AdminNavSection[] {
  return ADMIN_NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(role, item.permission)),
  })).filter((section) => section.items.length > 0);
}
