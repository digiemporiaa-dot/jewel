import { requirePermission } from '@/lib/auth/guard';
import { getMakingRules } from '@/lib/admin/making';
import PageHeader from '@/components/admin/PageHeader';
import MakingCharges from './MakingCharges';

export const dynamic = 'force-dynamic';

export default async function MakingChargesPage() {
  await requirePermission('making_charges.manage');
  const { rules, metals, categories, purities } = await getMakingRules();

  return (
    <div>
      <PageHeader
        title="Making Charges"
        description="Percentage, per-gram or flat rules resolved by Variant → Category+Metal+Purity → Category+Metal → Metal → Global."
      />
      <MakingCharges rules={rules} metals={metals} categories={categories} purities={purities} />
    </div>
  );
}
