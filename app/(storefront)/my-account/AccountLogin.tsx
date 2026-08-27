'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sendSignupOtp, verifySignupOtp } from '@/app/(storefront)/signup/actions';

/**
 * Signing in and signing up, on one screen.
 *
 * These used to be two pages with a text link between them, and a returning
 * customer who had forgotten they had an account could make a second one. The
 * page now asks for an address once and works out the rest itself.
 *
 * **Both buttons send the same code.** That is the part worth understanding.
 * The label is there so the customer can say what they *expect* — and if they
 * pick the wrong one, nothing bad happens, because what actually decides the
 * next screen is what the shop finds once the address is proven. A returning
 * customer who presses "Create account" is signed in; a new customer who
 * presses "Send login code" goes on to fill in their details. Neither is asked
 * to go back and press the other button.
 *
 * Nothing before verification says whether an address is known here. "No
 * account found" on a login attempt, or "you already have an account" on a
 * signup attempt, would let anyone test a list of addresses and learn who buys
 * jewellery from this shop. After the code, the same sentence is safe and
 * useful, because only the person holding the inbox can see it.
 */

type Step = 'email' | 'code';
type Intent = 'signin' | 'signup';

export default function AccountLogin() {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [step, setStep] = useState<Step>('email');
  /** Which button was pressed. Sets expectation and wording, never behaviour. */
  const [intent, setIntent] = useState<Intent>('signin');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validEmail = /.+@.+\..+/.test(email.trim());

  function send(which: Intent) {
    setError(null);
    setIntent(which);
    start(async () => {
      const res = await sendSignupOtp(email);
      if (!res.ok) { setError(res.error ?? 'Could not send the code'); return; }
      setStep('code');
      setDevCode(res.devCode ?? null);
    });
  }

  function verify() {
    setError(null);
    start(async () => {
      const res = await verifySignupOtp(email, otp);
      if (!res.ok) { setError(res.error ?? 'Incorrect code'); return; }

      // Where they go next is decided here, and both destinations are correct
      // for somebody who has just proved the address.
      //
      // The navigation is deliberate rather than incidental. Setting the session
      // cookie inside a server action makes Next re-render this route, which
      // sees a signed-in customer and swaps this panel for the account page —
      // so a details step rendered *inside* the panel would be torn off the
      // screen the instant it appeared. The same shape of bug as the spin
      // dialog that unmounted at the moment it awarded a prize.
      if (res.profileComplete) {
        router.refresh();
        return;
      }
      // `returning` is read on the next page to say "you already had an
      // account". Safe to put in a URL: by this point the code has been entered,
      // so the only person who can see it is the one holding the inbox.
      router.push(res.existingAccount && intent === 'signup' ? '/signup?returning=1' : '/signup');
    });
  }

  return (
    <div className="mx-auto max-w-sm border border-line bg-white p-6">
      <h1 className="font-heading text-2xl">Sign in or create an account</h1>
      <p className="mt-1 text-sm text-ink-soft">One address, one code. We will work out the rest.</p>

      {step === 'email' && (
        <div className="mt-6 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-soft">Email address</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              placeholder="you@example.com"
              className="w-full min-h-[48px] border border-line px-3 py-2.5 outline-none focus:border-brass"
            />
          </label>

          {/*
            Two buttons of the same size, one filled and one outlined. Equal
            weight, because for a shop like this neither audience is the
            afterthought — and a first-time customer offered a tiny link under a
            big button reads the link as the wrong door.

            Contrast, measured rather than assumed. The filled button is paper
            on velvet at 12.4:1 and the outlined one is ink on white at 18.3:1,
            both far past the 4.5:1 AA needs for text.

            The outlined button's border is overridden to velvet — 13.1:1 —
            because `btn-outline`'s default stone edge measures 1.69:1 against
            white, and for a button whose only visible boundary *is* that edge,
            WCAG 1.4.11 asks for 3:1. It shipped that way everywhere; this fixes
            the pair the brief cares about rather than restyling every outlined
            button in the shop in an unrelated change.

            `h-12` rather than `min-h`: btn-outline carries a 1px border, and a
            minimum let its content push it two pixels taller than the filled
            one. Two pixels is enough to make a deliberate pair look accidental.
          */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <button
              onClick={() => send('signin')}
              disabled={pending || !validEmail}
              className="btn-primary w-full h-12 justify-center disabled:opacity-50"
            >
              {pending && intent === 'signin' ? 'Sending…' : 'Send login code'}
            </button>
            <button
              onClick={() => send('signup')}
              disabled={pending || !validEmail}
              className="btn-outline w-full h-12 justify-center border-velvet disabled:opacity-50"
            >
              {pending && intent === 'signup' ? 'Sending…' : 'Create account'}
            </button>
          </div>

          <p className="pt-1 text-xs text-ink-soft">
            New here? Create an account to save your details and track orders. Already have one?
            Send yourself a login code — either way we email you a six-digit code.
          </p>
        </div>
      )}

      {step === 'code' && (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-ink-soft">
            We sent a six-digit code to <span className="text-ink">{email.trim()}</span>.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-soft">Enter the code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full min-h-[48px] border border-line px-3 py-2.5 tracking-[0.3em] outline-none focus:border-brass"
            />
          </label>
          {devCode && <p className="text-xs text-ink-soft">Dev code: <strong>{devCode}</strong></p>}
          <button onClick={verify} disabled={pending || otp.length !== 6} className="btn-primary w-full h-12 justify-center disabled:opacity-50">
            {pending ? 'Checking…' : 'Verify and continue'}
          </button>
          <div className="flex justify-between text-xs text-ink-soft">
            <button onClick={() => { setStep('email'); setOtp(''); }} disabled={pending} className="underline underline-offset-4 hover:text-brass">
              Change address
            </button>
            <button onClick={() => send(intent)} disabled={pending} className="underline underline-offset-4 hover:text-brass">
              Resend code
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <p className="mt-5 border-t border-line pt-4 text-xs text-ink-soft">
        By continuing you agree to our{' '}
        <Link href="/pages/terms" className="underline decoration-line-strong underline-offset-4 hover:text-brass">Terms</Link>
        {' '}and{' '}
        <Link href="/pages/privacy" className="underline decoration-line-strong underline-offset-4 hover:text-brass">Privacy Policy</Link>.
      </p>
    </div>
  );
}
