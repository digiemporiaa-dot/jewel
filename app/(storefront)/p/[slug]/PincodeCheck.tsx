'use client';

import { useState, useTransition } from 'react';
import { checkPincodeAction } from './actions';
import type { PincodeResult } from '@/lib/shipping/pincode';

export default function PincodeCheck() {
  const [pincode, setPincode] = useState('');
  const [result, setResult] = useState<PincodeResult | null>(null);
  const [pending, start] = useTransition();

  function check() {
    start(async () => setResult(await checkPincodeAction(pincode)));
  }

  return (
    <div>
      <label htmlFor="pincode-check" className="block text-xs tracking-[0.1em] uppercase text-ink-soft mb-1.5">
        Delivery &amp; serviceability
      </label>
      <div className="flex gap-2">
        <input
          id="pincode-check"
          inputMode="numeric"
          maxLength={6}
          value={pincode}
          onChange={(e) => { setPincode(e.target.value.replace(/\D/g, '')); setResult(null); }}
          placeholder="Enter pincode"
          className="flex-1 border border-line px-3 py-2 text-sm outline-none focus:border-brass"
        />
        <button onClick={check} disabled={pending || pincode.length !== 6} className="btn-outline text-xs px-4">
          {pending ? '…' : 'Check'}
        </button>
      </div>
      {result && (
        <p className={`mt-2 text-sm ${result.serviceable ? 'text-velvet' : 'text-red-700'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
