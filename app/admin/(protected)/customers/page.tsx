import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('customers.view');
  return (
    <SectionPlaceholder
      title="Customers"
      description="Customer profiles and order history"
      phase="Phase 6"
    />
  );
}
