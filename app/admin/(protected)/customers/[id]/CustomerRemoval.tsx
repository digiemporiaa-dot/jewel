'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import TypedConfirm from '@/components/admin/TypedConfirm';
import { deleteCustomerAction, restoreCustomerAction } from '../actions';

/**
 * Two different removals, and the difference matters.
 *
 * **Hide** takes the customer out of the lists and can be undone. **Erase**
 * scrubs the name, phone, email and dates and cannot — which is the point, since
 * it is what an erasure request asks for. Both keep every order, every total and
 * every invoice, because the shop is required to retain them and because sales
 * history that vanishes when a customer asks to be forgotten was never history.
 */
export default function CustomerRemoval({
  id, phone, orderCount, deletedAt, anonymisedAt,
}: {
  id: string;
  phone: string;
  orderCount: number;
  deletedAt: string | null;
  anonymisedAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (deletedAt) {
    return (
      <div className="border border-line bg-white p-5 space-y-2">
        <h2 className="font-heading text-base">Removed</h2>
        {anonymisedAt ? (
          <p className="text-sm text-ink-soft">
            Their details were erased on {new Date(anonymisedAt).toLocaleDateString('en-IN')} at their
            request. {orderCount > 0 ? `Their ${orderCount} order${orderCount === 1 ? '' : 's'} and the invoices remain.` : 'The accounting records remain.'} This cannot be undone.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              Hidden on {new Date(deletedAt).toLocaleDateString('en-IN')}. Nothing was erased.
            </p>
            <button
              disabled={pending}
              onClick={() => start(async () => {
                const res = await restoreCustomerAction(id);
                if (!res.ok) setError(res.error ?? 'Failed');
                else router.refresh();
              })}
              className="btn-outline text-xs"
            >
              {pending ? '…' : 'Restore'}
            </button>
          </>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border border-line bg-white p-5 space-y-4">
      <div>
        <h2 className="font-heading text-base">Remove this customer</h2>
        <p className="text-sm text-ink-soft">
          {orderCount > 0
            ? `They have ${orderCount} order${orderCount === 1 ? '' : 's'}. Those, their totals and their invoices are kept whichever option you choose — the shop is required to retain them.`
            : 'They have no orders yet.'}
        </p>
      </div>

      <TypedConfirm
        label="Hide from lists"
        tone="neutral"
        expected={phone}
        expectedLabel="phone number"
        confirmLabel="Hide customer"
        description={
          <>
            <p>Takes them out of the customer list and the campaign audience. Nothing is erased.</p>
            <p className="mt-1 text-ink-soft">Reversible — you can restore them from the archive.</p>
          </>
        }
        onConfirm={(typed) => deleteCustomerAction(id, typed, false)}
      />

      <TypedConfirm
        label="Erase personal details"
        expected={phone}
        expectedLabel="phone number"
        confirmLabel="Erase their details"
        description={
          <>
            <p>
              For an erasure request. The name, phone, email, date of birth and anniversary are
              replaced; the orders, their totals and the invoices stay.
            </p>
            <p className="mt-1 text-red-700">This cannot be undone — the details are gone, not hidden.</p>
          </>
        }
        onConfirm={(typed) => deleteCustomerAction(id, typed, true)}
      />
    </div>
  );
}
