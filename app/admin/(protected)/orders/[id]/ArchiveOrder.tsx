'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { archiveOrderAction, unarchiveOrderAction } from '../actions';

/**
 * Archive, and nothing stronger.
 *
 * There is deliberately no delete on this screen. An order carries a GST invoice
 * that has to be retained, a payment that can be disputed months later, and a
 * line in the year's sales figures. "Cancelled" already exists for an order that
 * is not going ahead; archiving is only about getting a finished one out of the
 * way of the ones that still need work.
 */
export default function ArchiveOrder({
  orderId, orderNumber, status, archivedAt, canArchive,
}: {
  orderId: string;
  orderNumber: string;
  status: string;
  archivedAt: string | null;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Failed');
      else router.refresh();
    });
  }

  return (
    <div className="border border-line bg-white p-5 space-y-2">
      <h2 className="font-heading text-base">Archive</h2>
      {archivedAt ? (
        <>
          <p className="text-sm text-ink-soft">
            Archived on {new Date(archivedAt).toLocaleDateString('en-IN')}. Nothing was removed — the
            invoice, the payments and the history are all intact.
          </p>
          <button disabled={pending} onClick={() => run(() => unarchiveOrderAction(orderId))} className="btn-outline text-xs">
            {pending ? '…' : 'Put back in the working list'}
          </button>
        </>
      ) : canArchive ? (
        <>
          <p className="text-sm text-ink-soft">
            Takes {orderNumber} out of the working list. It keeps its invoice number and still appears
            in reports and in any date range that includes it.
          </p>
          <button disabled={pending} onClick={() => run(() => archiveOrderAction(orderId))} className="btn-outline text-xs">
            {pending ? '…' : 'Archive this order'}
          </button>
        </>
      ) : (
        <p className="text-sm text-ink-soft">
          This order is {status.replace(/_/g, ' ').toLowerCase()} and still in progress. Orders can be
          archived once they are delivered, cancelled, refunded or returned — hiding a live order from
          the people who have to ship it is not something this does.
        </p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
