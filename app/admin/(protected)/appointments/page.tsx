import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('appointments.manage');
  return (
    <SectionPlaceholder
      title="Appointments"
      description="Showroom visits and video consultations"
      phase="Phase 6"
    />
  );
}
