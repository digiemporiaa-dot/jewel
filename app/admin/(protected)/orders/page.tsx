import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('orders.view');
  return (
    <SectionPlaceholder
      title="Orders"
      description="Order lifecycle, verification and fulfilment"
      phase="Phase 4"
    />
  );
}
