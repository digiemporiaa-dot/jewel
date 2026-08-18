import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('crm.access');
  return (
    <SectionPlaceholder
      title="CRM and Leads"
      description="Leads, follow-ups and call logs"
      phase="Phase 6"
    />
  );
}
