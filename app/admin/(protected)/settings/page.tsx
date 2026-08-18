import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('settings.manage');
  return (
    <SectionPlaceholder
      title="Settings"
      description="Store configuration and thresholds"
      phase="Phase 1"
    />
  );
}
