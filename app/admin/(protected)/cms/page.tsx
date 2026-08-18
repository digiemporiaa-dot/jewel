import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('cms.manage');
  return (
    <SectionPlaceholder
      title="CMS Pages"
      description="Block-based content management"
      phase="Phase 6"
    />
  );
}
