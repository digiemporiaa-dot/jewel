'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deactivateCouponAction } from '../actions';

/**
 * Deactivate, never delete: orders reference the coupon they were placed with,
 * and that link has to stay intact for refunds and chargebacks months later.
 */
export default function CouponStatusButton({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      onClick={() => start(async () => { await deactivateCouponAction(id); router.refresh(); })}
      disabled={pending}
      className="btn-outline text-xs"
    >
      {isActive ? 'Deactivate' : 'Reactivate'}
    </button>
  );
}
