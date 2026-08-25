'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sendSignupOtp, verifySignupOtp, completeSignup } from './actions';
import { DOB_PURPOSE, MINOR_CONSENT_NOTICE } from '@/lib/validations/signup';

type Step = 'phone' | 'code' | 'details' | 'done';

export default function SignupForm({
  initial,
  heading = 'Create your account',
  intro = 'One minute, and your orders, addresses and offers are all in one place.',
}: {
  /** Set when the phone is already verified — the account page's prompt. */
  initial?: { name: string; email: string; dob: string; anniversary: string; marketingOptIn: boolean } | null;
  heading?: string;
  intro?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(initial ? 'details' : 'phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    dob: initial?.dob ?? '',
    anniversary: initial?.anniversary ?? '',
    // Unticked. Under the DPDP Act consent has to be freely given and specific,
    // and a box that arrives already ticked is not a choice the customer made.
    marketingOptIn: initial?.marketingOptIn ?? false,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function send() {
    setError(null);
    start(async () => {
      const res = await sendSignupOtp(phone);
      if (res.ok) { setStep('code'); setDevCode(res.devCode ?? null); }
      else setError(res.error ?? 'Could not send the code');
    });
  }

  function verify() {
    setError(null);
    start(async () => {
      const res = await verifySignupOtp(phone, code);
      if (res.ok) setStep('details');
      else setError(res.error ?? 'Incorrect code');
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFieldError(null); setNotice(null);
    start(async () => {
      const res = await completeSignup(form);
      if (!res.ok) {
        setError(res.error);
        setFieldError(res.field ?? null);
        return;
      }
      // Said out loud rather than silently stored as false: the customer asked
      // for something and did not get it, and they are entitled to know why.
      if (res.refusedBecause === 'minor') setNotice(MINOR_CONSENT_NOTICE);
      // Deliberately no `router.refresh()`. Refreshing re-runs the page's server
      // component, which now sees a complete profile and redirects to the
      // account page — taking the confirmation, and the notice explaining why a
      // minor's marketing consent was refused, off screen before it can be read.
      // The success panel links onward when the customer is ready.
      setStep('done');
    });
  }

  if (step === 'done') {
    return (
      <div className="border border-line bg-white p-6 text-center">
        <h2 className="font-heading text-2xl">You&apos;re all set</h2>
        {notice ? (
          <p className="mt-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Your details are saved.</p>
        )}
        <Link href="/my-account" className="btn-primary mt-6 inline-flex">Go to my account</Link>
      </div>
    );
  }

  return (
    <div className="border border-line bg-white p-6">
      <h1 className="font-heading text-2xl">{heading}</h1>
      <p className="mt-1 text-sm text-ink-soft">{intro}</p>

      {step !== 'details' && (
        <div className="mt-6 space-y-3">
          <L label="Mobile number" hint="We send a one-time code to confirm it is yours.">
            <input
              inputMode="numeric" autoComplete="tel" value={phone} disabled={step === 'code'}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="s-inp disabled:bg-paper-2"
            />
          </L>

          {step === 'phone' ? (
            <button onClick={send} disabled={pending || phone.length !== 10} className="btn-primary w-full">
              {pending ? 'Sending…' : 'Send code'}
            </button>
          ) : (
            <>
              <L label="Enter the 6-digit code">
                <input
                  inputMode="numeric" autoComplete="one-time-code" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="s-inp"
                />
              </L>
              {devCode && <p className="text-xs text-ink-soft">Dev code: <strong>{devCode}</strong></p>}
              <button onClick={verify} disabled={pending || code.length !== 6} className="btn-primary w-full">
                {pending ? 'Checking…' : 'Verify'}
              </button>
              <button onClick={() => { setStep('phone'); setCode(''); }} disabled={pending} className="w-full text-xs text-ink-soft underline underline-offset-4">
                Change number
              </button>
            </>
          )}
        </div>
      )}

      {step === 'details' && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <L label="Full name">
            <input
              required autoComplete="name" value={form.name}
              onChange={(e) => set('name', e.target.value)} className="s-inp"
            />
          </L>

          <L label="Email address" invalid={fieldError === 'email'}>
            <input
              required type="email" autoComplete="email" value={form.email}
              onChange={(e) => set('email', e.target.value)} className="s-inp"
            />
          </L>

          {/* Purpose stated at the point of collection, not buried in a policy
              page. It is what the DPDP Act asks for, and it is also the reason
              people answer: an unexplained date-of-birth box reads as a data grab. */}
          <L label="Date of birth" hint={DOB_PURPOSE} invalid={fieldError === 'dob'}>
            <input
              required type="date" value={form.dob} max={today()}
              onChange={(e) => set('dob', e.target.value)} className="s-inp"
            />
          </L>

          <L label="Anniversary (optional)" hint="If you tell us, we will remember it too." invalid={fieldError === 'anniversary'}>
            <input
              type="date" value={form.anniversary} max={today()}
              onChange={(e) => set('anniversary', e.target.value)} className="s-inp"
            />
          </L>

          {/* Its own control, its own decision. Never folded into the submit
              button's label — "by creating an account you agree to receive
              offers" is not consent, it is a condition of service. */}
          <label className="flex items-start gap-2.5 border border-line bg-paper-2/50 p-3 text-sm">
            <input
              type="checkbox" checked={form.marketingOptIn}
              onChange={(e) => set('marketingOptIn', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Send me new collections, private previews and metal-rate alerts.
              <span className="mt-0.5 block text-xs text-ink-soft">
                Optional. Your account works the same either way, and you can stop them at any time.
              </span>
            </span>
          </label>

          <button disabled={pending} className="btn-primary w-full">
            {pending ? 'Saving…' : 'Create account'}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <style>{`.s-inp{width:100%;border:1px solid var(--line);padding:.625rem .75rem;font-size:.9rem;outline:none}.s-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}

/** `<input type="date" max>` wants a local calendar day, not an ISO instant. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function L({
  label, hint, invalid, children,
}: {
  label: string; hint?: string; invalid?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-ink-soft/85">{hint}</span>}
      <span className={invalid ? 'block [&_input]:border-red-400' : 'block'}>{children}</span>
    </label>
  );
}
