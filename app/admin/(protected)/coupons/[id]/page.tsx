import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import PageHeader from '@/components/admin/PageHeader';
import CouponForm from '../CouponForm';
import { getCouponRefs } from '../refs';
import { updateCouponAction } from '../actions';
import CouponStatusButton from './CouponStatusButton';

export const dynamic = 'force-dynamic';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone suffix. */
function toLocalInput(d: Date | null): string {
  if (!d) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default async function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('coupons.manage');
  const { id } = await params;

  const [coupon, refs] = await Promise.all([
    prisma.coupon.findUnique({ where: { id } }),
    getCouponRefs(),
  ]);
  if (!coupon) notFound();

  const dec = (v: unknown) => (v === null || v === undefined ? '' : String(v));

  return (
    <div>
      <PageHeader
        title={coupon.code}
        description={`Redeemed ${coupon.usageCount}${coupon.usageLimit !== null ? ` of ${coupon.usageLimit}` : ' times'}`}
        action={{ label: 'Back', href: '/admin/coupons' }}
      />

      <div className="mb-4">
        <CouponStatusButton id={coupon.id} isActive={coupon.isActive} />
      </div>

      <CouponForm
        action={updateCouponAction.bind(null, coupon.id)}
        refs={refs}
        submitLabel="Save changes"
        defaults={{
          code: coupon.code,
          description: coupon.description ?? '',
          type: coupon.type,
          appliesTo: coupon.appliesTo,
          value: dec(coupon.value),
          minOrder: dec(coupon.minOrder),
          maxDiscount: dec(coupon.maxDiscount),
          usageLimit: dec(coupon.usageLimit),
          perUserLimit: dec(coupon.perUserLimit),
          minWeightGrams: dec(coupon.minWeightGrams),
          maxWeightGrams: dec(coupon.maxWeightGrams),
          startsAt: toLocalInput(coupon.startsAt),
          endsAt: toLocalInput(coupon.endsAt),
          isActive: coupon.isActive,
          excludeDiscounted: coupon.excludeDiscounted,
          firstOrderOnly: coupon.firstOrderOnly,
          stackable: coupon.stackable,
          categoryIds: coupon.categoryIds,
          collectionIds: coupon.collectionIds,
          metalTypes: coupon.metalTypes,
          purities: coupon.purities,
        }}
      />
    </div>
  );
}
