'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sendCheckoutOtp, verifyCheckoutOtp } from '@/app/(storefront)/checkout/actions';

export default function AccountLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const res = await sendCheckoutOtp(phone);
      if (res.ok) { setSent(true); setDevCode(res.devCode ?? null); }
      else setError(res.error ?? 'Could not send code');
    });
  }
  function verify() {
    setError(null);
    start(async () => {
      const res = await verifyCheckoutOtp(phone, otp);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Invalid code');
    });
  }

  return (
    <div className="max-w-sm mx-auto border border-line bg-white p-6">
      <h1 className="font-heading text-xl mb-1">Sign in</h1>
      <p className="text-sm text-ink-soft mb-4">Enter your mobile number to receive a one-time code.</p>

      <label className="block text-sm mb-3">
        <span className="block mb-1 text-xs text-ink-soft">Mobile number</span>
        <input value={phone} onChange={(e) => { setPhone(e.target.value); setSent(false); }} className="w-full border border-line px-3 py-2.5 outline-none focus:border-brass" />
      </label>

      {!sent ? (
        <button onClick={send} disabled={pending || phone.length < 10} className="btn-primary w-full">{pending ? 'Sending…' : 'Send OTP'}</button>
      ) : (
        <>
          <label className="block text-sm mb-3">
            <span className="block mb-1 text-xs text-ink-soft">Enter OTP</span>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full border border-line px-3 py-2.5 outline-none focus:border-brass" />
          </label>
          {devCode && <p className="text-xs text-ink-soft mb-2">Dev code: <strong>{devCode}</strong></p>}
          <button onClick={verify} disabled={pending || otp.length !== 6} className="btn-primary w-full">{pending ? 'Verifying…' : 'Verify & sign in'}</button>
          <button onClick={send} disabled={pending} className="mt-2 text-xs text-ink-soft underline w-full">Resend code</button>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {/* Signing in and signing up are the same OTP either way — the difference
          is only whether we then ask for a name and a birthday. Saying so beats
          leaving a first-time shopper wondering which button is theirs. */}
      <p className="mt-4 border-t border-line pt-4 text-xs text-ink-soft">
        First time here?{' '}
        <Link href="/signup" className="underline decoration-line-strong underline-offset-4 hover:text-brass">
          Create an account
        </Link>{' '}
        — same one-time code, and we save your details for next time.
      </p>
    </div>
  );
}
