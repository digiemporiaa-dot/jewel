import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('inventory.manage');
  return (
    <SectionPlaceholder
      title="Inventory"
      description="Stock, reservations and low-stock alerts"
      phase="Phase 2"
    />
  );
}
