import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('staff.manage');
  return (
    <SectionPlaceholder
      title="Staff and Roles"
      description="Manage staff accounts and permissions"
      phase="Phase 1"
    />
  );
}
