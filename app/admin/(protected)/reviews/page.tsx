import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('reviews.moderate');
  return (
    <SectionPlaceholder
      title="Reviews"
      description="Moderate customer reviews"
      phase="Phase 6"
    />
  );
}
