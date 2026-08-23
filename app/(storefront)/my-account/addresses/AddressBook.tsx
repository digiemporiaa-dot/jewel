'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import type { SavedAddress } from '@/lib/addresses';
import { saveAddressAction, deleteAddressAction, setDefaultAddressAction } from './actions';

/**
 * Saved addresses.
 *
 * The point of the feature is the second order: a returning customer should not
 * retype a shipping address on a ₹1.2 lakh purchase, because that is where an
 * order gets abandoned.
 */
export default function AddressBook({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(addresses.length === 0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong');
      else { done?.(); router.refresh(); }
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>, close: () => void) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveAddressAction(fd), close);
  }

  return (
    <div className="space-y-4">
      {addresses.map((a) =>
        editing === a.id ? (
          <AddressForm
            key={a.id}
            address={a}
            pending={pending}
            onSubmit={(e) => submit(e, () => setEditing(null))}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div key={a.id} className={cn('border p-4', a.isDefault ? 'border-brass' : 'border-line')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">
                  {a.name}
                  {a.label && <span className="ml-2 text-xs text-ink-soft">{a.label}</span>}
                  {a.isDefault && <span className="ml-2 text-xs text-brass">Default</span>}
                </p>
                <p className="text-ink-soft mt-1">
                  {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
                  {a.city}, {a.state} {a.pincode}
                </p>
                <p className="text-ink-soft text-xs mt-1">{a.phone}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {!a.isDefault && (
                  <button
                    disabled={pending}
                    onClick={() => run(() => setDefaultAddressAction(a.id))}
                    className="underline decoration-line-strong underline-offset-4 hover:text-brass"
                  >
                    Make default
                  </button>
                )}
                <button onClick={() => setEditing(a.id)} className="underline decoration-line-strong underline-offset-4 hover:text-brass">
                  Edit
                </button>
                <button
                  disabled={pending}
                  onClick={() => run(() => deleteAddressAction(a.id))}
                  className="underline decoration-line-strong underline-offset-4 text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {adding ? (
        <AddressForm
          pending={pending}
          onSubmit={(e) => submit(e, () => setAdding(false))}
          onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
        />
      ) : (
        <button onClick={() => setAdding(true)} className="btn-outline text-sm">Add an address</button>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function AddressForm({
  address, pending, onSubmit, onCancel,
}: {
  address?: SavedAddress;
  pending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="border border-line p-4 space-y-3">
      {address && <input type="hidden" name="addressId" value={address.id} />}
      <div className="grid sm:grid-cols-2 gap-3">
        <F label="Full name"><input name="name" defaultValue={address?.name} required className="a-inp" /></F>
        <F label="Mobile number"><input name="phone" defaultValue={address?.phone} required inputMode="numeric" maxLength={10} className="a-inp" /></F>
      </div>
      <F label="Address line 1"><input name="line1" defaultValue={address?.line1} required className="a-inp" /></F>
      <F label="Address line 2 (optional)"><input name="line2" defaultValue={address?.line2 ?? ''} className="a-inp" /></F>
      <div className="grid sm:grid-cols-3 gap-3">
        <F label="City"><input name="city" defaultValue={address?.city} required className="a-inp" /></F>
        <F label="State"><input name="state" defaultValue={address?.state} required className="a-inp" /></F>
        <F label="Pincode"><input name="pincode" defaultValue={address?.pincode} required inputMode="numeric" maxLength={6} className="a-inp" /></F>
      </div>
      <F label="Label (optional)"><input name="label" defaultValue={address?.label ?? ''} placeholder="Home, Office" className="a-inp" /></F>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDefault" defaultChecked={address?.isDefault} />
        <span>Use this address by default at checkout</span>
      </label>
      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary text-sm">{pending ? 'Saving…' : 'Save address'}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-outline text-sm">Cancel</button>}
      </div>
      <style>{`.a-inp{width:100%;border:1px solid var(--line);padding:.55rem .7rem;font-size:.9rem;outline:none}.a-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
