'use client';

import { useState, useTransition } from 'react';
import { deleteProductAction } from '../actions';

export default function DeleteProductButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return <button onClick={() => setConfirming(true)} className="btn-outline text-xs text-red-700 border-red-300">Delete product</button>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-red-700">Delete permanently?</span>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          const res = await deleteProductAction(id);
          if (res && !res.ok) setError(res.error ?? 'Failed');
        })}
        className="btn-primary text-xs py-1 bg-red-700 hover:bg-red-800"
      >
        {pending ? '…' : 'Yes, delete'}
      </button>
      <button onClick={() => setConfirming(false)} className="btn-outline text-xs py-1">Cancel</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
