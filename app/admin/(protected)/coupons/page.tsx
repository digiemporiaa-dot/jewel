import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

const SCOPE_LABELS: Record<string, string> = {
  MAKING_CHARGES: 'Making charges',
  METAL_VALUE: 'Metal value',
  STONE_VALUE: 'Stones',
  ORDER_TOTAL: 'Whole order',
};

export default async function CouponsPage() {
  await requirePermission('coupons.manage');
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <div>
      <PageHeader
        title="Coupons"
        description="Discounts are calculated per qualifying item, on one component — not on the bag total."
        action={{ label: 'New coupon', href: '/admin/coupons/new' }}
      />

      {coupons.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No coupons yet</p>
          <Link href="/admin/coupons/new" className="btn-primary mt-4 inline-flex">Create one</Link>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="border-b border-line text-left">
              <tr className="text-xs tracking-[0.08em] uppercase text-ink-soft">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Applies to</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {coupons.map((c) => {
                const exhausted = c.usageLimit !== null && c.usageCount >= c.usageLimit;
                const expired = c.endsAt !== null && c.endsAt < new Date();
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/coupons/${c.id}`} className="font-medium hover:text-brass">{c.code}</Link>
                      {c.description && <p className="text-xs text-ink-soft">{c.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {c.type === 'FREE_SHIPPING' ? 'Free shipping'
                        : c.type === 'PERCENTAGE' ? `${Number(c.value)}%`
                        : formatCurrency(c.value)}
                    </td>
                    <td className="px-4 py-3">
                      {c.type === 'FREE_SHIPPING' ? '—' : (
                        <span className={cn(c.appliesTo === 'ORDER_TOTAL' || c.appliesTo === 'METAL_VALUE' ? 'text-amber-800' : '')}>
                          {SCOPE_LABELS[c.appliesTo] ?? c.appliesTo}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {c.usageCount}{c.usageLimit !== null ? ` / ${c.usageLimit}` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">
                      {c.startsAt ? formatDate(c.startsAt) : '—'} → {c.endsAt ? formatDate(c.endsAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'text-[0.65rem] tracking-[0.06em] uppercase border px-1.5 py-0.5',
                        !c.isActive ? 'border-line text-ink-soft'
                          : exhausted || expired ? 'border-amber-300 bg-amber-50 text-amber-900'
                          : 'border-velvet/40 text-velvet'
                      )}>
                        {!c.isActive ? 'Inactive' : exhausted ? 'Fully used' : expired ? 'Expired' : 'Live'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
