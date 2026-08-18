import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('making_charges.manage');
  return (
    <SectionPlaceholder
      title="Making Charges"
      description="Percentage, per-gram and flat making rules"
      phase="Phase 2"
    />
  );
}
