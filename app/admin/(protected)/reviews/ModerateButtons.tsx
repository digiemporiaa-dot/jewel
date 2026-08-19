'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { moderateReviewAction } from './actions';

export default function ModerateButtons({ reviewId, status }: { reviewId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function set(next: string) {
    start(async () => {
      const res = await moderateReviewAction(reviewId, next);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex gap-2 shrink-0">
      {status !== 'APPROVED' && (
        <button disabled={pending} onClick={() => set('APPROVED')} className="btn-primary text-xs py-1 px-3">Approve</button>
      )}
      {status !== 'REJECTED' && (
        <button disabled={pending} onClick={() => set('REJECTED')} className="btn-outline text-xs py-1 px-3">Reject</button>
      )}
    </div>
  );
}
