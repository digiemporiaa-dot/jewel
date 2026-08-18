import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('categories.manage');
  return (
    <SectionPlaceholder
      title="Categories"
      description="Catalogue taxonomy"
      phase="Phase 2"
    />
  );
}
