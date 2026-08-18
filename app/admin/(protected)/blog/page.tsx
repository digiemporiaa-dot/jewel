import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('blog.manage');
  return (
    <SectionPlaceholder
      title="Blog"
      description="Articles and editorial content"
      phase="Phase 6"
    />
  );
}
