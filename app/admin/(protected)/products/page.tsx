import { requirePermission } from '@/lib/auth/guard';
import SectionPlaceholder from '@/components/admin/SectionPlaceholder';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('products.manage');
  return (
    <SectionPlaceholder
      title="Products"
      description="Catalogue products, variants and images"
      phase="Phase 2"
    />
  );
}
