import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('collections.manage');
  return (
    <SectionPlaceholder
      title="Collections"
      description="Curated product groupings"
      phase="Phase 2"
    />
  );
}
