import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('shipments.manage');
  return (
    <SectionPlaceholder
      title="Shipments"
      description="Shiprocket shipments, AWB and tracking"
      phase="Phase 5"
    />
  );
}
