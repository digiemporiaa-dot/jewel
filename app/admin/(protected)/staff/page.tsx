import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import PageHeader from '@/components/admin/PageHeader';
import StaffManager from './StaffManager';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  // `staff.manage` is granted to SUPER_ADMIN only (lib/auth/rbac.ts).
  await requirePermission('staff.manage');

  const staff = await prisma.user.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true },
  });

  return (
    <div>
      <PageHeader title="Staff & Roles" description="Create accounts, assign roles and disable access. Every change is audited." />
      <StaffManager
        staff={staff.map((s) => ({ ...s, lastLoginAt: s.lastLoginAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
