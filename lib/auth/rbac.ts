import { Role } from '@prisma/client';

/**
 * Central capability model. Authorization is ALWAYS enforced server-side against
 * this matrix (brief §30: "Hiding a menu item is NOT authorization"). The admin
 * nav is filtered by the same `can()` used to guard server actions and routes.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'products.manage',
  'categories.manage',
  'collections.manage',
  'rates.manage',
  'making_charges.manage',
  'inventory.manage',
  'cms.manage',
  'blog.manage',
  'orders.view',
  'orders.manage',
  'shipments.manage',
  'customers.view',
  'crm.access',
  'leads.manage',
  'coupons.manage',
  'reviews.moderate',
  'appointments.manage',
  'finance.manage',
  'settings.manage',
  'staff.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

// Actions reserved for SUPER_ADMIN (the "highly destructive system actions").
const SUPER_ONLY: Permission[] = ['staff.manage'];

const CATALOG: Permission[] = [
  'dashboard.view',
  'products.manage',
  'categories.manage',
  'collections.manage',
  'rates.manage',
  'making_charges.manage',
  'inventory.manage',
  'cms.manage',
  'blog.manage',
];

const SALES: Permission[] = [
  'dashboard.view',
  'crm.access',
  'leads.manage',
  'orders.view',
  'customers.view',
  'coupons.manage',
  'appointments.manage',
];

const DISPATCH: Permission[] = [
  'dashboard.view',
  'orders.view',
  'shipments.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: ALL,
  // ADMIN gets everything except the super-admin-only destructive actions.
  [Role.ADMIN]: ALL.filter((p) => !SUPER_ONLY.includes(p)),
  [Role.CATALOG_MANAGER]: CATALOG,
  [Role.SALES_EXECUTIVE]: SALES,
  [Role.DISPATCH]: DISPATCH,
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(role: Role | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPER_ADMIN]: 'Super Admin',
  [Role.ADMIN]: 'Admin',
  [Role.CATALOG_MANAGER]: 'Catalog Manager',
  [Role.SALES_EXECUTIVE]: 'Sales Executive',
  [Role.DISPATCH]: 'Dispatch',
};
