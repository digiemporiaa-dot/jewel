import { requirePermission } from '@/lib/auth/guard';
import PageHeader from '@/components/admin/PageHeader';
import CouponForm from '../CouponForm';
import { getCouponRefs } from '../refs';
import { createCouponAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewCouponPage() {
  await requirePermission('coupons.manage');
  const refs = await getCouponRefs();

  return (
    <div>
      <PageHeader title="New coupon" description="Defaults to discounting making charges — where the margin is." action={{ label: 'Back', href: '/admin/coupons' }} />
      <CouponForm action={createCouponAction} refs={refs} submitLabel="Create coupon" />
    </div>
  );
}
