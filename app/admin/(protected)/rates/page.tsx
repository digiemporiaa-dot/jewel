import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('rates.manage');
  return (
    <SectionPlaceholder
      title="Metal Rates"
      description="Update live rates with catalogue impact preview"
      phase="Phase 2"
    />
  );
}
