import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('coupons.manage');
  return (
    <SectionPlaceholder
      title="Coupons"
      description="Discount codes and promotions"
      phase="Phase 4"
    />
  );
}
