import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listReviewsForModeration, getReviewCounts } from '@/lib/reviews';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import ModerateButtons from './ModerateButtons';
import { ReviewStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePermission('reviews.moderate');
  const sp = await searchParams;
  const status = sp.status && sp.status in ReviewStatus ? (sp.status as ReviewStatus) : ReviewStatus.PENDING;

  const [reviews, counts] = await Promise.all([listReviewsForModeration(status), getReviewCounts()]);

  return (
    <div>
      <PageHeader title="Reviews" description="Approve or reject customer reviews before they appear on the storefront." />

      <div className="mb-4 flex gap-2 text-xs">
        {Object.values(ReviewStatus).map((s) => (
          <Link key={s} href={`/admin/reviews?status=${s}`} className={cn('btn-outline', status === s && 'border-brass text-brass')}>
            {s} ({counts[s]})
          </Link>
        ))}
      </div>

      {reviews.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No {status.toLowerCase()} reviews</p>
        </div>
      ) : (
        <div className="border border-line bg-white divide-y divide-line/60">
          {reviews.map((r) => (
            <div key={r.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-brass text-sm">{'★'.repeat(r.rating)}<span className="text-line-strong">{'★'.repeat(5 - r.rating)}</span></span>
                  {r.verifiedPurchase && <span className="text-[0.65rem] uppercase tracking-[0.1em] text-velvet border border-velvet px-1.5 py-0.5 rounded-[2px]">Verified</span>}
                </div>
                {r.title && <p className="mt-1 font-medium text-sm">{r.title}</p>}
                {r.body && <p className="text-sm text-ink-soft mt-0.5">{r.body}</p>}
                <p className="text-xs text-ink-soft mt-1">
                  <Link href={`/p/${r.product.slug}`} className="underline underline-offset-2 hover:text-brass">{r.product.name}</Link>
                  {' · '}{r.customer?.name ?? r.customer?.phone ?? 'Customer'} · {formatDate(r.createdAt)}
                </p>
              </div>
              <ModerateButtons reviewId={r.id} status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
