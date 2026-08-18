import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('audit.view');
  return (
    <SectionPlaceholder
      title="Audit Log"
      description="Immutable record of sensitive actions"
      phase="Phase 7"
    />
  );
}
