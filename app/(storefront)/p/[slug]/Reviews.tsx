'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/format';
import { submitReviewAction } from './review-actions';

export type ReviewItem = {
  id: string; rating: number; title: string | null; body: string | null;
  verifiedPurchase: boolean; authorName: string; createdAt: string;
};

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('text-brass', className)} aria-label={`${value} out of 5`}>
      {'★'.repeat(value)}<span className="text-line-strong">{'★'.repeat(5 - value)}</span>
    </span>
  );
}

export default function Reviews({
  productId, slug, reviews, average, count, canReview, reason,
}: {
  productId: string; slug: string; reviews: ReviewItem[];
  average: number | null; count: number; canReview: boolean; reason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await submitReviewAction({ productId, slug, rating, title, body });
      if (res.ok) { setDone(true); setOpen(false); router.refresh(); }
      else setError(res.error ?? 'Could not submit');
    });
  }

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading text-2xl">Customer reviews</h2>
          {count > 0 && average !== null ? (
            <p className="mt-1 text-sm text-ink-soft"><Stars value={Math.round(average)} /> {average.toFixed(1)} · {count} review{count === 1 ? '' : 's'}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">No reviews yet.</p>
          )}
        </div>
        {canReview ? (
          <button onClick={() => setOpen((v) => !v)} className="btn-outline text-xs">{open ? 'Cancel' : 'Write a review'}</button>
        ) : (
          reason && <p className="text-xs text-ink-soft">{reason}</p>
        )}
      </div>

      {done && <p className="mb-4 border border-line bg-paper-2 px-4 py-3 text-sm">Thank you — your review has been submitted and will appear once approved.</p>}

      {open && canReview && (
        <form onSubmit={submit} className="border border-line bg-white p-5 mb-6 space-y-3 max-w-lg">
          <div>
            <p className="text-xs tracking-[0.1em] uppercase text-ink-soft mb-1.5">Your rating</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star`}
                  className={cn('text-2xl leading-none', n <= rating ? 'text-brass' : 'text-line-strong')}>★</button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="block mb-1 text-xs text-ink-soft">Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-line px-3 py-2 outline-none focus:border-brass" />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-xs text-ink-soft">Your review</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full border border-line px-3 py-2 outline-none focus:border-brass" />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button disabled={pending} className="btn-primary text-xs">{pending ? 'Submitting…' : 'Submit review'}</button>
          <p className="text-xs text-ink-soft">Reviews are published after a quick check by our team.</p>
        </form>
      )}

      {reviews.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {reviews.map((r) => (
            <article key={r.id} className="border border-line p-5">
              <div className="flex items-center justify-between">
                <Stars value={r.rating} />
                {r.verifiedPurchase && <span className="text-[0.65rem] tracking-[0.1em] uppercase text-velvet border border-velvet px-2 py-0.5 rounded-[2px]">Verified purchase</span>}
              </div>
              {r.title && <h3 className="mt-2 font-heading text-lg">{r.title}</h3>}
              {r.body && <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">{r.body}</p>}
              <p className="mt-3 text-xs text-ink-soft">{r.authorName} · {formatDate(r.createdAt)}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
