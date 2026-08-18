import { describe, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import { navForRole } from '@/lib/admin/nav';
import { can, canAny, ROLE_PERMISSIONS } from '@/lib/auth/rbac';

describe('RBAC permission matrix', () => {
  it('SUPER_ADMIN can do everything', () => {
    expect(can(Role.SUPER_ADMIN, 'staff.manage')).toBe(true);
    expect(can(Role.SUPER_ADMIN, 'settings.manage')).toBe(true);
    expect(can(Role.SUPER_ADMIN, 'rates.manage')).toBe(true);
  });

  it('ADMIN has everything except the super-admin-only staff.manage', () => {
    expect(can(Role.ADMIN, 'settings.manage')).toBe(true);
    expect(can(Role.ADMIN, 'rates.manage')).toBe(true);
    expect(can(Role.ADMIN, 'staff.manage')).toBe(false);
  });

  it('CATALOG_MANAGER manages catalog but not orders or settings', () => {
    expect(can(Role.CATALOG_MANAGER, 'products.manage')).toBe(true);
    expect(can(Role.CATALOG_MANAGER, 'rates.manage')).toBe(true);
    expect(can(Role.CATALOG_MANAGER, 'orders.manage')).toBe(false);
    expect(can(Role.CATALOG_MANAGER, 'settings.manage')).toBe(false);
  });

  it('SALES_EXECUTIVE cannot touch rates, settings, staff or finance', () => {
    expect(can(Role.SALES_EXECUTIVE, 'crm.access')).toBe(true);
    expect(can(Role.SALES_EXECUTIVE, 'orders.view')).toBe(true);
    expect(can(Role.SALES_EXECUTIVE, 'rates.manage')).toBe(false);
    expect(can(Role.SALES_EXECUTIVE, 'settings.manage')).toBe(false);
    expect(can(Role.SALES_EXECUTIVE, 'staff.manage')).toBe(false);
    expect(can(Role.SALES_EXECUTIVE, 'finance.manage')).toBe(false);
  });

  it('DISPATCH is limited to dashboard, orders view and shipments', () => {
    expect(can(Role.DISPATCH, 'shipments.manage')).toBe(true);
    expect(can(Role.DISPATCH, 'orders.view')).toBe(true);
    expect(can(Role.DISPATCH, 'products.manage')).toBe(false);
    expect(can(Role.DISPATCH, 'rates.manage')).toBe(false);
  });

  it('canAny returns true if any permission is granted', () => {
    expect(canAny(Role.DISPATCH, ['rates.manage', 'shipments.manage'])).toBe(true);
    expect(canAny(Role.DISPATCH, ['rates.manage', 'settings.manage'])).toBe(false);
  });

  it('nav is filtered per role and never empty for a valid role', () => {
    for (const role of Object.values(Role)) {
      const nav = navForRole(role);
      expect(nav.length).toBeGreaterThan(0);
      // Every visible item must actually be permitted (menu visibility == permission).
      for (const section of nav) {
        for (const item of section.items) {
          expect(ROLE_PERMISSIONS[role]).toContain(item.permission);
        }
      }
    }
  });
});
